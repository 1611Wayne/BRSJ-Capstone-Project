-- Correct the clearance_types catalog: 13 -> 9, confirmed with the real client
-- Generated 2026-10-05. Depends on 20260923010000_seed_clearance_types.sql.
-- Context: ../../../../CHANGES.md, "Frontend: branch divergence reconciled,
-- clearance types corrected 13->9" entry for this date.
--
-- WHY: the 13 names seeded on 2026-09-23 came from the paper's own Scope
-- (Ch. 1.4), on the assumption that the paper's list was accurate. It wasn't.
-- The user went to the Barangay San Jose office and asked staff directly what
-- clearance types are actually issued there: only 9 are real. Ambulant and
-- Lessor (Paupahan) are folded into Business Clearance (not separate types);
-- Film Shooting and Products Promo Clearance don't exist at this barangay at
-- all. This is real-world ground truth from the actual client superseding a
-- number the paper happened to state — exactly the kind of correction the
-- architecture was deliberately left provisional for.
--
-- WHY DEACTIVATE, NOT DELETE: this table's own comment (migration 1) already
-- says "Deactivate via active=false rather than deleting one that is already
-- referenced by applications" — the `active` column exists for precisely this
-- situation. No real applications reference these four rows yet (nothing has
-- been seeded there), so a hard delete would technically succeed today, but
-- deactivating is the documented convention, keeps the audit trail if a row
-- was ever touched by mistake, and won't need revisiting once real
-- applications data exists (a later delete would fail outright: `applications
-- .clearance_type_id references clearance_types(id) on delete restrict`).
--
-- NOT DONE HERE, ON PURPOSE: nothing in application code has been built yet
-- that reads clearance_types from Supabase (the frontend prototype still uses
-- its own hardcoded list, not this table) — so there's no query to add an
-- `active = true` filter to yet. Whoever wires the real application form to
-- this table should filter on `active` then, not before.

update public.clearance_types
set description = 'For local businesses including stores, Ambulant vendors, and Lessors (Paupahan).'
where name = 'Business Clearance';

update public.clearance_types
set active = false
where name in (
  'Ambulant Clearance',
  'Lessor (Paupahan) Clearance',
  'Film Shooting Clearance',
  'Products Promo Clearance'
);
