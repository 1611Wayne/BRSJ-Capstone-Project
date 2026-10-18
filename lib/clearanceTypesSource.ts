import 'server-only';
import type { ClearanceType } from '@/types';
import { clearanceTypes as sampleTypes } from '@/data/clearanceTypes';
import { supabaseAdmin, supabaseConfigured } from '@/lib/supabase/server';

export type ClearanceTypesResult = { types: ClearanceType[]; source: 'database' | 'sample' };

const slug = (name: string) => name.toLowerCase().replace(/clearance/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The active clearance types, from the database when it is configured, otherwise the built-in sample list.
// The page keeps the short ids the app already links with (business, lot-survey, ...) by matching on the name,
// so /resident/apply?type=business keeps working whichever source is used.
export async function getClearanceTypes(): Promise<ClearanceTypesResult> {
  if (!supabaseConfigured()) return { types: sampleTypes, source: 'sample' };
  const { data, error } = await supabaseAdmin()
    .from('clearance_types')
    .select('name, short_name, description, icon')   // public columns only; never select('*') with the secret key
    .eq('active', true)
    .order('id');
  if (error || !data?.length) {
    console.error('Clearance types: could not read the database, showing the sample list instead.', error?.message ?? 'no active rows');
    return { types: sampleTypes, source: 'sample' };
  }
  const types = data.map((row) => {
    const known = sampleTypes.find((t) => t.name === row.name);
    return {
      id: known?.id ?? slug(row.name),
      name: row.name,
      shortName: row.short_name || known?.shortName || row.name,
      description: row.description || known?.description || '',
      icon: row.icon || known?.icon || 'Store',
    };
  });
  return { types, source: 'database' };
}
