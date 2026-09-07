import type { Application, ApplicationStatus } from '@/types';
import { mockFeeSchedules } from './mockFeeSchedules';
const seeds: [string, string, ApplicationStatus, string, string][] = [
  ['000123', 'Business Clearance', 'Pending Assessment', 'resident-maria', 'Maria Clara'],
  ['000124', 'Building Clearance', 'Awaiting OR', 'resident-juan', 'Juan Dela Cruz'],
  ['000125', 'Electrical Clearance', 'Ready for Download', 'resident-maria', 'Maria Clara'],
  ['000119', 'TODA Clearance', 'Closed - Cleared', 'resident-andres', 'Andres Rizal'],
  ['000117', 'Lessor (Paupahan) Clearance', 'Closed - Cleared', 'resident-maria', 'Maria Clara'],
  ['000126', 'Business Clearance', 'Awaiting OR', 'resident-maria', 'Maria Clara'],
];
export const mockApplications: Application[] = seeds.map(([number, type, status, residentId, applicant], index) => {
  const schedule = mockFeeSchedules.find(s => s.clearanceType === type)!;
  const assessed = status !== 'Pending Assessment';
  const issued = status === 'Ready for Download' || status === 'Closed - Cleared';
  return {
    reference: `SJ-2026-${number}`, residentId, applicant, address: 'San Jose, Rodriguez, Rizal', contact: '09123456789', purpose: 'Clearance requirement', clearanceType: type, dateRequested: '2026-09-06T08:00:00+08:00', status,
    businessName: 'Maria Mini Mart', businessLocation: 'San Jose, Rodriguez, Rizal', initialOperation: '2025-01-15', applicationType: 'New Application', ownership: 'Owner', propertyOwner: '', businessContact: '09123456789', source: 'Online', staffEncoder: 'Maria Staff', certified: true,
    documents: (type === 'Business Clearance' ? ['Valid ID of Owner', 'Picture of Establishment / Business', 'DTI / SEC Document'] : ['Valid ID', 'Supporting Property / Clearance Document']).map((requirement, i) => ({ requirement, name: `sample-document-${i + 1}.pdf`, size: 1024, type: 'application/pdf', status: 'Verified' })),
    assessment: assessed ? { items: schedule.items, total: schedule.items.reduce((sum, item) => sum + item.amount, 0), category: schedule.category, classification: schedule.classification, assessedBy: 'Maria Staff', assessedAt: '2026-09-06T09:00:00+08:00', scheduleId: schedule.id } : undefined,
    receipt: issued ? { orNumber: `TR-2026-${12340 + index}`, orDate: '2026-09-06', amountPaid: schedule.items.reduce((sum, item) => sum + item.amount, 0), recordedAt: '2026-09-06T10:30:12+08:00', encodedBy: 'Maria Staff' } : undefined,
    clearance: issued ? { issueDate: '2026-09-06', generatedAt: '2026-09-06T10:30:15+08:00' } : undefined,
    confirmation: status === 'Closed - Cleared' ? { timestamp: '2026-09-06T10:35:00+08:00', completionTime: '2026-09-06T10:35:00+08:00', ipPlaceholder: 'Not collected (prototype)' } : undefined,
    feedback: status === 'Closed - Cleared' ? { rating: 5, comment: 'Clear instructions and convenient service.', submittedAt: '2026-09-06T10:36:00+08:00' } : undefined,
  };
});
