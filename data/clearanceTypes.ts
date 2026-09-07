import type { ClearanceType } from '@/types';

export const clearanceTypes: ClearanceType[] = [
  { id: 'business', name: 'Business Clearance', shortName: 'Business', description: 'For local business clearance requirements.', icon: 'Store' },
  { id: 'building', name: 'Building Clearance', shortName: 'Building', description: 'For residential or commercial building construction.', icon: 'Building2' },
  { id: 'electrical', name: 'Electrical Clearance', shortName: 'Electrical', description: 'For electrical installation and wiring requirements.', icon: 'Cable' },
  { id: 'fencing', name: 'Fencing Clearance', shortName: 'Fencing', description: 'For perimeter wall or fence construction.', icon: 'Fence' },
  { id: 'excavation', name: 'Excavation Clearance', shortName: 'Excavation', description: 'For earth-moving or digging projects.', icon: 'Pickaxe' },
  { id: 'lot-survey', name: 'Lot Survey Clearance', shortName: 'Lot Survey', description: 'For land area measurement and verification.', icon: 'Map' },
  { id: 'water-mwss', name: 'Water/MWSS Clearance', shortName: 'Water/MWSS', description: 'For water service connection applications.', icon: 'Droplet' },
  { id: 'poda', name: 'PODA Clearance', shortName: 'PODA', description: 'For applicable PODA clearance requirements.', icon: 'IdCard' },
  { id: 'toda', name: 'TODA Clearance', shortName: 'TODA', description: 'For tricycle operator and driver association requirements.', icon: 'Bike' },
  { id: 'ambulant', name: 'Ambulant Clearance', shortName: 'Ambulant', description: 'For street vendors and mobile businesses.', icon: 'ShoppingBag' },
  { id: 'lessor', name: 'Lessor (Paupahan) Clearance', shortName: 'Lessor (Paupahan)', description: 'For rental property owners and landlords.', icon: 'House' },
  { id: 'film', name: 'Film Shooting Clearance', shortName: 'Film Shooting', description: 'For commercial or indie film production activities.', icon: 'Clapperboard' },
  { id: 'products-promo', name: 'Products Promo Clearance', shortName: 'Products Promo', description: 'For product marketing and promotional activities.', icon: 'Megaphone' },
];
