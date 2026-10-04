import type { ClearanceType } from '@/types';

export const clearanceTypes: ClearanceType[] = [
  { id: 'business', name: 'Business Clearance', shortName: 'Business', description: 'For local businesses including stores, Ambulant vendors, and Lessors (Paupahan).', icon: 'Store' },
  { id: 'building', name: 'Building Clearance', shortName: 'Building', description: 'For residential or commercial building construction.', icon: 'Building2' },
  { id: 'electrical', name: 'Electrical Clearance', shortName: 'Electrical', description: 'For electrical installation and wiring requirements.', icon: 'Cable' },
  { id: 'fencing', name: 'Fencing Clearance', shortName: 'Fencing', description: 'For perimeter wall or fence construction.', icon: 'Fence' },
  { id: 'excavation', name: 'Excavation Clearance', shortName: 'Excavation', description: 'For earth-moving or digging projects.', icon: 'Pickaxe' },
  { id: 'lot-survey', name: 'Lot Survey Clearance', shortName: 'Lot Survey', description: 'For land area measurement and verification.', icon: 'Map' },
  { id: 'water-mwss', name: 'Water/MWSS Clearance', shortName: 'Water/MWSS', description: 'For water service connection applications.', icon: 'Droplet' },
  { id: 'poda', name: 'PODA Clearance', shortName: 'PODA', description: 'For applicable PODA clearance requirements.', icon: 'IdCard' },
  { id: 'toda', name: 'TODA Clearance', shortName: 'TODA', description: 'For tricycle operator and driver association requirements.', icon: 'Bike' },
];
