import type { RevenueCategory } from '@/types';

export const revenueCategories: RevenueCategory[] = [
  {
    name: 'Sari-Sari Store',
    classifications: [
      { name: 'Small', businessClearance: 100 },
      { name: 'Medium', businessClearance: 300 },
      { name: 'Large', businessClearance: 500 },
    ],
  },
  {
    name: 'Bakery',
    classifications: [
      { name: 'Small', businessClearance: 500 },
      { name: 'Medium', businessClearance: 750 },
      { name: 'Large', businessClearance: 1000 },
    ],
  },
  {
    name: 'Beauty Parlor / Salon',
    classifications: [
      { name: 'Small', businessClearance: 500 },
      { name: 'Large', businessClearance: 1000 },
    ],
  },
  {
    name: 'Carinderia',
    classifications: [
      { name: 'Small', businessClearance: 500 },
      { name: 'Large', businessClearance: 1000 },
    ],
  },
  {
    name: 'Lessor',
    classifications: [
      { name: '1–4 Units', businessClearance: 1000 },
      { name: '5–8 Units', businessClearance: 1500 },
      { name: '9+ Units', businessClearance: 2500 },
    ],
  },
  { name: 'Ambulant / Mobile Vendor', businessClearance: 250 },
  { name: 'Bank', businessClearance: 2500 },
];

export const standardAssessmentFees = {
  plate: 150,
  inspectionFee: 50,
  sticker: 100,
  penalty: 0,
  employeeFee: 50,
};

export function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
}
