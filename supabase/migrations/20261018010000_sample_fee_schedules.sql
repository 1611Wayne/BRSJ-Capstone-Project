-- SAMPLE fee data so Staff can test the assessment end to end. Generated 2026-10-18 from the prototype's own data
-- (data/revenueCodeData.ts and data/mockFeeSchedules.ts), so the numbers are exactly the ones the prototype shows.
-- Depends on 20261018000000_reference_numbers.sql.
--
-- *** THESE ARE NOT THE APPROVED REVENUE CODE AMOUNTS. *** Every schedule says so in ordinance_reference and
-- reason_notes. When the barangay gives the approved Revenue Code, add the real schedules as NEW rows with a later
-- effective_date (the newest effective schedule wins, older rows stay as history), or remove these sample rows before
-- any real request is assessed with them. This is on the "remove or replace before handover" list in CHANGES.md.
--
-- WHAT IT ADDS: 7 business categories, 13 classifications, 23 fee schedules (one per clearance type,
-- category and classification, effective 2026-01-01) with 6 fee lines each, in the prototype's order:
-- <clearance type> fee, Plate, Inspection Fee, Sticker, Penalty, No. of Employee.
-- Non-business clearance types have no category or classification (both NULL), as in the prototype.
--
-- ALSO: fee_schedules.created_by may now be NULL, meaning "loaded by the system" (no person made this schedule);
-- every schedule made by an Admin still records who made it.
--
-- RE-RUNNABLE ON PURPOSE: categories, classifications and schedules are inserted only if missing, and a schedule's
-- lines only when that schedule has none.

alter table public.fee_schedules alter column created_by drop not null;
comment on column public.fee_schedules.created_by is 'The Admin who made this schedule; NULL = loaded by the system (sample or imported data).';

insert into public.business_categories (name) values
  ('Sari-Sari Store'),
  ('Bakery'),
  ('Beauty Parlor / Salon'),
  ('Carinderia'),
  ('Lessor'),
  ('Ambulant / Mobile Vendor'),
  ('Bank')
on conflict (name) do nothing;

insert into public.business_classifications (category_id, name)
select c.id, v.name
from (values
  ('Sari-Sari Store', 'Small'),
  ('Sari-Sari Store', 'Medium'),
  ('Sari-Sari Store', 'Large'),
  ('Bakery', 'Small'),
  ('Bakery', 'Medium'),
  ('Bakery', 'Large'),
  ('Beauty Parlor / Salon', 'Small'),
  ('Beauty Parlor / Salon', 'Large'),
  ('Carinderia', 'Small'),
  ('Carinderia', 'Large'),
  ('Lessor', '1–4 Units'),
  ('Lessor', '5–8 Units'),
  ('Lessor', '9+ Units')
) as v(category, name)
join public.business_categories c on c.name = v.category
on conflict (category_id, name) do nothing;

do $$
declare
  r record;
  sched_id integer;
  i integer;
begin
  for r in
    select * from (values
  ('Business Clearance', 'Sari-Sari Store', 'Small', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[100.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Sari-Sari Store', 'Medium', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[300.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Sari-Sari Store', 'Large', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Bakery', 'Small', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Bakery', 'Medium', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[750.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Bakery', 'Large', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1000.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Beauty Parlor / Salon', 'Small', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Beauty Parlor / Salon', 'Large', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1000.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Carinderia', 'Small', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Carinderia', 'Large', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1000.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Lessor', '1–4 Units', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1000.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Lessor', '5–8 Units', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Lessor', '9+ Units', '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[2500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Ambulant / Mobile Vendor', null, '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[250.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Business Clearance', 'Bank', null, '2026-01-01', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[2500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[]),
  ('Building Clearance', null, null, '2026-01-01', array['Building Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Electrical Clearance', null, null, '2026-01-01', array['Electrical Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[350.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Fencing Clearance', null, null, '2026-01-01', array['Fencing Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Excavation Clearance', null, null, '2026-01-01', array['Excavation Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Lot Survey Clearance', null, null, '2026-01-01', array['Lot Survey Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('Water/MWSS Clearance', null, null, '2026-01-01', array['Water/MWSS Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('PODA Clearance', null, null, '2026-01-01', array['PODA Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[]),
  ('TODA Clearance', null, null, '2026-01-01', array['TODA Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[500.00, 0.00, 50.00, 0.00, 0.00, 0.00]::numeric[])
    ) as v(clearance_type, category, classification, effective_date, names, amounts)
  loop
    select s.id into sched_id
    from public.fee_schedules s
    join public.clearance_types t on t.id = s.clearance_type_id and t.name = r.clearance_type
    left join public.business_categories c on c.id = s.business_category_id
    left join public.business_classifications k on k.id = s.classification_id
    where s.effective_date = r.effective_date::date
      and c.name is not distinct from r.category
      and k.name is not distinct from r.classification;

    if sched_id is null then
      insert into public.fee_schedules (clearance_type_id, business_category_id, classification_id, effective_date, ordinance_reference, reason_notes, created_by)
      select t.id, c.id, k.id, r.effective_date::date,
             'SAMPLE Revenue Code schedule (illustrative, NOT the approved Revenue Code)',
             'SAMPLE fees copied from the prototype for testing; replace with the approved Revenue Code before real use.',
             null
      from public.clearance_types t
      left join public.business_categories c on c.name = r.category
      left join public.business_classifications k on k.category_id = c.id and k.name = r.classification
      where t.name = r.clearance_type
      returning id into sched_id;
    end if;

    if sched_id is null then
      raise exception 'Sample fee schedule could not be created for % / % / %', r.clearance_type, r.category, r.classification;
    end if;

    if not exists (select 1 from public.fee_schedule_items where fee_schedule_id = sched_id) then
      for i in 1 .. array_length(r.names, 1) loop
        insert into public.fee_schedule_items (fee_schedule_id, component_name, amount)
        values (sched_id, r.names[i], r.amounts[i]);
      end loop;
    end if;
  end loop;
end $$;
