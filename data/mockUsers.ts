import type { User } from '@/types';
const base = { status: 'Active' as const, createdAt: '2026-08-20T08:00:00+08:00', contact: '09123456789', address: 'San Jose, Rodriguez, Rizal' };
export const mockUsers: User[] = [
  { ...base, id: 'resident-maria', firstName: 'Maria', lastName: 'Clara', email: 'maria@example.com', password: 'resident123', role: 'resident' },
  { ...base, id: 'resident-juan', firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@example.com', password: 'resident123', role: 'resident' },
  { ...base, id: 'resident-andres', firstName: 'Andres', lastName: 'Rizal', email: 'andres@example.com', password: 'resident123', role: 'resident' },
  { ...base, id: 'staff-maria', firstName: 'Maria', lastName: 'Staff', email: 'staff@san-jose.gov', password: 'staff123', role: 'staff' },
  { ...base, id: 'staff-pedro', firstName: 'Pedro', lastName: 'Staff', email: 'pstaff', password: 'staff123', role: 'staff' },
  { ...base, id: 'admin', firstName: 'Admin', lastName: 'San Jose', email: 'admin@san-jose.gov', password: 'admin123', role: 'admin' },
];
export const fullName = (user: User) => `${user.firstName} ${user.lastName}`;
