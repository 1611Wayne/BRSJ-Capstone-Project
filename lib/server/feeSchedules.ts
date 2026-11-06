import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeeSchedule } from '@/types';

type Row = Record<string, any>;
const one = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Row | undefined;

// The fee schedules from the database (of one clearance type, or all of them), in the prototype's shape, so the
// prototype's own activeSchedule() picks the effective one (newest effective date not in the future). The id is the database id.
export async function loadFeeSchedules(db: SupabaseClient, clearanceType?: string): Promise<(FeeSchedule & { categoryId: number | null; classificationId: number | null })[]> {
  let query = db.from('fee_schedules')
    .select('id, effective_date, ordinance_reference, reason_notes, created_at, business_category_id, classification_id, clearance_types!inner ( name ), business_categories ( name ), business_classifications ( name ), fee_schedule_items ( id, component_name, amount )');
  if (clearanceType !== undefined) query = query.eq('clearance_types.name', clearanceType);
  const { data, error } = await query;
  if (error) throw new Error('Could not load the fee schedules: ' + error.message);
  return (data ?? []).map((s: Row) => ({
    id: String(s.id), clearanceType: one(s.clearance_types)?.name ?? clearanceType ?? '', category: one(s.business_categories)?.name ?? '', classification: one(s.business_classifications)?.name ?? '',
    items: [...(s.fee_schedule_items ?? [])].sort((a: Row, b: Row) => a.id - b.id).map((i: Row) => ({ name: i.component_name, amount: Number(i.amount) })),
    effectiveDate: s.effective_date, ordinance: s.ordinance_reference, notes: s.reason_notes, changedBy: 'Admin', createdAt: s.created_at,
    categoryId: s.business_category_id, classificationId: s.classification_id,
  }));
}
