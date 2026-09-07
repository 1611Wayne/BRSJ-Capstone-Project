import { clearanceTypes } from './clearanceTypes';
import { revenueCategories } from './revenueCodeData';
import type { FeeSchedule } from '@/types';
// Illustrative values only: no official Revenue Code document is included.
export const mockFeeSchedules: FeeSchedule[] = clearanceTypes.flatMap(type => {
  const categories = type.id === 'business' ? revenueCategories : [{ name: '', businessClearance: type.id === 'electrical' ? 350 : 500 }];
  return categories.flatMap(category => (category.classifications || [{ name: '', businessClearance: category.businessClearance || 0 }]).map(scale => ({
    id: `${type.id}-${category.name}-${scale.name}-v1`, clearanceType: type.name, category: category.name, classification: scale.name,
    items: [{ name: type.name, amount: scale.businessClearance }, { name: 'Plate', amount: type.id === 'business' ? 150 : 0 }, { name: 'Inspection Fee', amount: 50 }, { name: 'Sticker', amount: type.id === 'business' ? 100 : 0 }, { name: 'Penalty', amount: 0 }, { name: 'No. of Employee', amount: 0 }],
    effectiveDate: '2026-01-01', ordinance: 'Sample Revenue Code schedule', notes: 'Illustrative fees; replace with approved values.', changedBy: 'Admin San Jose', createdAt: '2026-01-01T08:00:00+08:00',
  })));
});
