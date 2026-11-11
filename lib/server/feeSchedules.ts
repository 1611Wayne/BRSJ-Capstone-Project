import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeeSchedule } from '@/types';

type Row = Record<string, any>;
const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Row | undefined;

// The fee schedules from the database (of one clearance type, or all of them), in the prototype's shape, so the
// prototype's own activeSchedule() picks the effective one (newest effective date not in the future; on the same date,
// the one saved last). The id is the database id; changedBy is the name of the Admin who saved that version.
export async function loadFeeSchedules(db: SupabaseClient, clearanceType?: string): Promise<(FeeSchedule & { categoryId: number | null; classificationId: number | null })[]> {
  let query = db.from('fee_schedules')
    .select('id, effective_date, ordinance_reference, reason_notes, created_at, business_category_id, classification_id, clearance_types!inner ( name ), business_categories ( name ), business_classifications ( name ), profiles ( first_name, last_name ), fee_schedule_items ( id, component_name, amount )');
  if (clearanceType !== undefined) query = query.eq('clearance_types.name', clearanceType);
  const { data, error } = await query;
  if (error) throw new Error('Could not load the fee schedules: ' + error.message);
  return (data ?? []).map((s: Row) => {
    const by = one(s.profiles);
    return {
      id: String(s.id), clearanceType: one(s.clearance_types)?.name ?? clearanceType ?? '', category: one(s.business_categories)?.name ?? '', classification: one(s.business_classifications)?.name ?? '',
      items: [...(s.fee_schedule_items ?? [])].sort((a: Row, b: Row) => a.id - b.id).map((i: Row) => ({ name: i.component_name, amount: Number(i.amount) })),
      effectiveDate: s.effective_date, ordinance: s.ordinance_reference, notes: s.reason_notes,
      changedBy: [by?.first_name, by?.last_name].filter(Boolean).join(' ') || 'Admin', createdAt: s.created_at,
      categoryId: s.business_category_id, classificationId: s.classification_id,
    };
  });
}

// Saves one checked fee schedule as a NEW version (the table is append-only history; older versions and the
// assessments made with them stay as they are). Returns the new version's database id.
export async function insertFeeSchedule(db: SupabaseClient, s: FeeSchedule, createdBy: string): Promise<number> {
  const { data: type } = await db.from('clearance_types').select('id').eq('name', s.clearanceType).maybeSingle();
  if (!type) throw Object.assign(new Error('This clearance type is not in the database.'), { status: 400 });
  let categoryId: number | null = null, classificationId: number | null = null;
  if (s.category) {
    const { data: category } = await db.from('business_categories').select('id').eq('name', s.category).maybeSingle();
    if (!category) throw Object.assign(new Error(`The business category "${s.category}" is not in the database.`), { status: 400 });
    categoryId = category.id;
    if (s.classification) {
      const { data: classification } = await db.from('business_classifications').select('id').eq('category_id', category.id).eq('name', s.classification).maybeSingle();
      if (!classification) throw Object.assign(new Error(`The classification "${s.classification}" is not in the database for ${s.category}.`), { status: 400 });
      classificationId = classification.id;
    }
  }
  const { data: row, error } = await db.from('fee_schedules').insert({
    clearance_type_id: type.id, business_category_id: categoryId, classification_id: classificationId, effective_date: s.effectiveDate,
    ordinance_reference: s.ordinance, reason_notes: s.notes, created_by: createdBy,
  }).select('id').single();
  if (error || !row) {
    const sameDay = error?.code === '23505';
    throw new Error(sameDay
      ? 'A version with this effective date already exists. Run migration 18 on Supabase (it allows several versions on one day), or choose another date.'
      : 'The fee schedule was not saved: ' + (error?.message ?? 'no answer'));
  }
  const { error: itemsError } = await db.from('fee_schedule_items').insert(s.items.map(i => ({ fee_schedule_id: row.id, component_name: i.name, amount: i.amount })));
  if (itemsError) {
    await db.from('fee_schedules').delete().eq('id', row.id);   // never leave a version without its fee lines
    throw new Error('The fee lines were not saved, so the new version was removed: ' + itemsError.message);
  }
  return row.id;
}
