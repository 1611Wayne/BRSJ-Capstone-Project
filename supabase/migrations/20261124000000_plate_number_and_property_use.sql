-- Migration 28 (2026-11-24): new details on a request, all printed on the clearance.
--
-- 1. plate_number: the plate printed on a Business or TODA clearance ("Plate No."). The barangay's own clearance
--    (sample received 2026-11-24) shows, at the bottom right: O.R. NO., Amount, Plate No., Date Issued, Place Issued.
--    The OR number and amount are already saved (official_receipts); Date Issued and Place Issued refer to the business
--    permit and stay blank to fill in by hand. Staff type the plate when they verify the payment (optional); the
--    clearance prints NO PLATE when it is empty. An Admin can correct it with the transaction reversion. Same rule as the
--    app (lib/workflow.ts validPlateNumber): letters, numbers, spaces or dashes, up to 30, starting with a letter or number.
--
-- 2. property_use: the applicant's "Remarks", Residential or Commercial, on the property clearances (Building,
--    Electrical, Fencing, Excavation, Lot Survey, Water/MWSS). UAT notes 2026-11-24: these ask only Name, Residential
--    Address, Location, Remarks and Purpose, as printed on the clearance. NULL for Business, TODA and PODA.
--
-- 3. vehicle_type, registration_number, body_number: TODA and PODA (UAT notes, 2026-11-24). TODA asks Name / Operator,
--    Address, Type of Vehicle, Registration No., Plate No. (plate_number above, typed by the applicant) and Body Number,
--    with the OR/CR of the vehicle; PODA asks Name, Address, Type of Vehicle and Body Number, with the certification
--    from their association. registration_number is TODA only. Up to 40 characters each. NULL for every other type.
-- RE-RUNNABLE.

alter table public.applications add column if not exists plate_number text;
alter table public.applications drop constraint if exists applications_plate_number_check;
alter table public.applications add constraint applications_plate_number_check
  check (plate_number is null or plate_number ~ '^[A-Za-z0-9][A-Za-z0-9 -]{0,29}$');
comment on column public.applications.plate_number is
  'Plate number printed on a Business or TODA clearance as "Plate No." (typed by Staff when verifying payment; NULL = NO PLATE). Migration 28.';

alter table public.applications add column if not exists property_use text;
alter table public.applications drop constraint if exists applications_property_use_check;
alter table public.applications add constraint applications_property_use_check
  check (property_use is null or property_use in ('Residential', 'Commercial'));
comment on column public.applications.property_use is
  'Remarks on a property clearance (Building, Electrical, Fencing, Excavation, Lot Survey, Water/MWSS): Residential or Commercial, chosen by the applicant and printed on the clearance. NULL for Business, TODA and PODA. Migration 28.';

alter table public.applications add column if not exists vehicle_type text;
alter table public.applications add column if not exists registration_number text;
alter table public.applications add column if not exists body_number text;
alter table public.applications drop constraint if exists applications_vehicle_details_check;
alter table public.applications add constraint applications_vehicle_details_check check (
  (vehicle_type is null or char_length(btrim(vehicle_type)) between 1 and 40)
  and (registration_number is null or char_length(btrim(registration_number)) between 1 and 40)
  and (body_number is null or char_length(btrim(body_number)) between 1 and 40));
comment on column public.applications.vehicle_type is 'TODA / PODA: type of vehicle (e.g. Tricycle). Migration 28.';
comment on column public.applications.registration_number is 'TODA: registration number of the vehicle (from the OR/CR). Migration 28.';
comment on column public.applications.body_number is 'TODA / PODA: body number of the vehicle. Migration 28.';
