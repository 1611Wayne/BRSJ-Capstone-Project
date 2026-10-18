import 'server-only';
import type { Application, ApplicationInput, UploadedDocument } from '@/types';

// Column list for reading an application with its clearance type name and documents (see SCHEMA_MAP.md, section 2).
export const APPLICATION_SELECT = `id, reference_no, resident_id, applicant_name, address, contact_number, purpose, date_requested, created_at, status,
  business_name, business_location, date_initial_operation, application_type, ownership_type, property_owner_name, business_contact,
  source, certified, has_employees, employee_count, business_subcategory, rejection_reason, rejected_at,
  clearance_types ( name ),
  application_documents ( requirement_name, storage_path, original_filename, mime_type, file_size, verification_status, note )`;

type Row = Record<string, any>;

export function toApplication(r: Row): Application {
  const docs: UploadedDocument[] = (r.application_documents ?? []).map((d: Row) => ({
    requirement: d.requirement_name, name: d.original_filename ?? '', size: d.file_size ?? 0, type: d.mime_type ?? '',
    status: d.verification_status, ...(d.note ? { note: d.note } : {}), ...(d.storage_path ? { path: d.storage_path } : {}),
  }));
  return {
    reference: r.reference_no, dbId: r.id, residentId: r.resident_id, applicant: r.applicant_name, address: r.address, contact: r.contact_number,
    purpose: r.purpose, clearanceType: r.clearance_types?.name ?? '', dateRequested: r.date_requested ?? r.created_at, status: r.status,
    businessName: r.business_name, businessLocation: r.business_location, initialOperation: r.date_initial_operation ?? '',
    applicationType: r.application_type, ownership: r.ownership_type, propertyOwner: r.property_owner_name, businessContact: r.business_contact,
    source: r.source, documents: docs, certified: r.certified,
    ...(r.has_employees === null || r.has_employees === undefined ? {} : { hasEmployees: r.has_employees }),
    ...(r.employee_count ? { employeeCount: r.employee_count } : {}),
    ...(r.business_subcategory ? { businessSubcategory: r.business_subcategory } : {}),
    ...(r.rejection_reason ? { rejection: { reason: r.rejection_reason, rejectedBy: 'Staff', timestamp: r.rejected_at } } : {}),
  };
}

// The Applicant-entered columns of an application (never status, reference, owner or Staff fields).
export function applicantColumns(a: ApplicationInput, clearanceTypeId: number) {
  const business = a.clearanceType === 'Business Clearance';
  return {
    clearance_type_id: clearanceTypeId, applicant_name: a.applicant.trim(), address: a.address.trim(), contact_number: a.contact.trim(),
    purpose: a.purpose.trim(), business_name: a.businessName.trim(), business_location: a.businessLocation.trim(),
    date_initial_operation: a.initialOperation || null, application_type: a.applicationType, ownership_type: a.ownership,
    property_owner_name: a.ownership === 'Owner' ? '' : a.propertyOwner.trim(), business_contact: a.businessContact.trim(),
    certified: !!a.certified,
    has_employees: a.hasEmployees ?? null, employee_count: a.hasEmployees && a.employeeCount && a.employeeCount > 0 ? Math.floor(a.employeeCount) : null,
    business_subcategory: business ? a.businessSubcategory ?? null : null,
  };
}
