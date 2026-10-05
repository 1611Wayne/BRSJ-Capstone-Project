'use client';
import { presetRange, type DateRangePreset } from '@/lib/workflow';
const presets: { key: DateRangePreset; label: string }[] = [{ key: 'annual', label: 'Annual' }, { key: 'quarterly', label: 'Quarterly' }, { key: 'weekly', label: 'Weekly' }, { key: 'daily', label: 'Daily' }];
// Quick-fill buttons for a From/To date range. Clicking one fills both fields with that calendar
// period; the fields stay editable afterward, so a manual tweak is just "custom" — no separate mode.
export function DateRangePresets({ from, to, onSelect }: { from: string; to: string; onSelect: (range: { from: string; to: string }) => void }) {
  return <div className="flex gap-2 flex-wrap">{presets.map(p => {
    const range = presetRange(p.key);
    const active = from === range.from && to === range.to;
    return <button key={p.key} type="button" className={`px-3 py-1.5 text-xs rounded border ${active ? 'border-brand-primary bg-brand-soft text-brand-ink font-semibold' : 'border-slate-300 text-slate-600 hover:border-brand-primary'}`} onClick={() => onSelect(range)}>{p.label}</button>;
  })}</div>;
}
