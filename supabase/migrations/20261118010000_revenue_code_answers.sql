-- Fee schedule update from the 2019 Revenue Code sheet: the barangay's answers of 2026-11-18. Generated 2026-11-18 by
-- "paperwork (for revisions)/Revenue Code 2019 (photos)/build_fee_update.cjs", which compares "Revenue Code 2019 -
-- encoded.csv" with the fees in force on the live project. Do not edit by hand; never edit it once it has been run.
--
-- WHAT IT DOES: 1 new schedule(s), 0 new version(s) where an amount changed (effective 2026-11-18; the
-- older version stays as history), 9 schedule note(s) corrected in place (notes only, never an amount, and
-- only on the rows the system loaded: created_by is NULL). Adds 1 schedule(s) with 6 fee line(s).
--   + Business Clearance|School: Review Center|
--   * Excavation Clearance|| (notes)
--   * TODA Clearance|| (notes)
--   * Business Clearance|Household Beauty Products Manufacturers / Repacking| (notes)
--   * Business Clearance|Laundry Shop - Per Unit| (notes)
--   * Business Clearance|Watch Repair Shop|Small (notes)
--   * Business Clearance|Watch Repair Shop|Large (notes)
--   * Business Clearance|Balloons & Party Needs w/ Videoke (Per Unit)| (notes)
--   * Business Clearance|Photo Copying / Xerox Center (Clearance & Per Unit)| (notes)
--   * Business Clearance|Video Game Shop (Per Unit)| (notes)
-- RE-RUNNABLE: inserts only what is missing; note updates only where the note still differs.

insert into public.business_categories (name) values
  ('School: Review Center')
on conflict (name) do nothing;

do $$
declare r record; sched_id integer; i integer;
begin
  for r in select * from (values
  ('Business Clearance', 'School: Review Center', null, date '2026-11-18', array['Business Clearance', 'Plate', 'Inspection Fee', 'Sticker', 'Penalty', 'No. of Employee'], array[1500.00, 150.00, 50.00, 100.00, 0.00, 0.00]::numeric[], 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): Handwritten under Vocational/technical; it belongs to that category, so 1,500 like the other schools.')
  ) as v(clearance_type, category, classification, effective_date, names, amounts, notes)
  loop
    sched_id := null;
    select s.id into sched_id from public.fee_schedules s
    join public.clearance_types t on t.id = s.clearance_type_id and t.name = r.clearance_type
    left join public.business_categories c on c.id = s.business_category_id
    left join public.business_classifications k on k.id = s.classification_id
    where s.effective_date = r.effective_date and s.ordinance_reference = 'Revised Revenue Code of Barangay San Jose, Chapter V (Sangguniang Barangay session, 3 December 2019)' and s.reason_notes = r.notes
      and c.name is not distinct from r.category and k.name is not distinct from r.classification
    limit 1;
    if sched_id is null then
      insert into public.fee_schedules (clearance_type_id, business_category_id, classification_id, effective_date, ordinance_reference, reason_notes, created_by)
      select t.id, c.id, k.id, r.effective_date, 'Revised Revenue Code of Barangay San Jose, Chapter V (Sangguniang Barangay session, 3 December 2019)', r.notes, null
      from public.clearance_types t
      left join public.business_categories c on c.name = r.category
      left join public.business_classifications k on k.category_id = c.id and k.name = r.classification
      where t.name = r.clearance_type
      returning id into sched_id;
    end if;
    if sched_id is null then raise exception 'Fee schedule could not be created for % / % / %', r.clearance_type, r.category, r.classification; end if;
    if not exists (select 1 from public.fee_schedule_items where fee_schedule_id = sched_id) then
      for i in 1 .. array_length(r.names, 1) loop
        insert into public.fee_schedule_items (fee_schedule_id, component_name, amount) values (sched_id, r.names[i], r.amounts[i]);
      end loop;
    end if;
  end loop;
end $$;

update public.fee_schedules f set reason_notes = v.notes
from (values
  ('Excavation Clearance', null, null, date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): 5.00 per linear meter is right; ignore the handwritten question mark. Inspection Fee left at 0: the Revenue Code lists no inspection fee for this permit; Staff can enter 50 (small) or 100 (big) when an inspection is done. Per-unit fee: the line holds one unit; Staff enter the total for the actual number of units.'),
  ('TODA Clearance', null, null, date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): Our TODA Clearance is the Franchise Permit (TODA), 50. Inspection Fee left at 0: the Revenue Code lists no inspection fee for this permit; Staff can enter 50 (small) or 100 (big) when an inspection is done.'),
  ('Business Clearance', 'Household Beauty Products Manufacturers / Repacking', null, date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): Handwritten line at the bottom of the page; the wording read in the group leader''s sheet is right ("Household Beauty Products Manufacturers / Repacking"), 1,500.'),
  ('Business Clearance', 'Laundry Shop - Per Unit', null, date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): 500 plus 100 per unit. Per-unit fee: the line holds one unit; Staff enter the total for the actual number of units.'),
  ('Business Clearance', 'Watch Repair Shop', 'Small', date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): Small 300 / large 500 is right (page 22 lists 300 only). (The group leader''s sheet has 500 here: row shift.)'),
  ('Business Clearance', 'Watch Repair Shop', 'Large', date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): Small 300 / large 500 is right (page 22 lists 300 only). (The group leader''s sheet has 500 here: row shift.)'),
  ('Business Clearance', 'Balloons & Party Needs w/ Videoke (Per Unit)', null, date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): 1,000 plus 300 per videoke unit. Per-unit fee: the line holds one unit; Staff enter the total for the actual number of units.'),
  ('Business Clearance', 'Photo Copying / Xerox Center (Clearance & Per Unit)', null, date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): 200 plus 150 per unit (machine). Per-unit fee: the line holds one unit; Staff enter the total for the actual number of units.'),
  ('Business Clearance', 'Video Game Shop (Per Unit)', null, date '2026-11-18', 'Loaded from the photos of the 2019 Revised Revenue Code (encoded and cross-checked 2026-11-18). Confirmed by the barangay (2026-11-18): 500 plus 150 per unit. Per-unit fee: the line holds one unit; Staff enter the total for the actual number of units.')
) as v(clearance_type, category, classification, effective_date, notes)
join public.clearance_types t on t.name = v.clearance_type
left join public.business_categories c on c.name = v.category
left join public.business_classifications k on k.category_id = c.id and k.name = v.classification
where f.clearance_type_id = t.id and f.business_category_id is not distinct from c.id and f.classification_id is not distinct from k.id
  and f.ordinance_reference = 'Revised Revenue Code of Barangay San Jose, Chapter V (Sangguniang Barangay session, 3 December 2019)' and f.effective_date = v.effective_date and f.created_by is null
  and f.reason_notes is distinct from v.notes;
