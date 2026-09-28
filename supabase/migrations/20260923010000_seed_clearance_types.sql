-- Seed: the 13 clearance types
-- Generated 2026-09-23. Depends on 20260922000000_init_schema.sql.
-- Context: ../../../CHANGES.md, "Seed data" entry for this date.
--
-- WHAT THIS SEEDS: only the clearance_types catalog — 13 rows, name/short_name/
-- description/icon. The `name` values come straight from the paper's own Scope
-- (Chapter 1.4) and match Capstone-frontend/data/clearanceTypes.ts exactly —
-- these are the confirmed 13 real clearance types, not a guess.
--
-- WHAT THIS DELIBERATELY DOES NOT SEED, AND WHY: business_categories,
-- business_classifications, fee_schedules, and fee_schedule_items stay empty.
-- The only fee/category data anywhere in this project (Capstone-frontend's
-- revenueCodeData.ts) is explicitly marked illustrative, not the real Revenue
-- Code. Seeding it here risks it being mistaken for real numbers later. This
-- migration is scoped narrowly to what's actually confirmed: the type names.
--
-- ALSO NOT RESOLVED BY THIS: each type's actual required documents / form
-- fields. Only Business Clearance has a detailed real form; the other 12 use
-- generic placeholder fields "pending their approved official forms" (the
-- frontend's own words). Seeding the 13 names is a small, narrow step — it
-- does not mean the per-type form/requirements question is answered.
--
-- short_name/description/icon below are carried over as-is from the frontend
-- prototype's existing UI copy — reasonable to seed since they're just
-- display text already in use, not financial or legal data, and freely
-- editable later without the stakes fee data would carry.

insert into public.clearance_types (name, short_name, description, icon) values
  ('Business Clearance', 'Business', 'For local business clearance requirements.', 'Store'),
  ('Building Clearance', 'Building', 'For residential or commercial building construction.', 'Building2'),
  ('Electrical Clearance', 'Electrical', 'For electrical installation and wiring requirements.', 'Cable'),
  ('Fencing Clearance', 'Fencing', 'For perimeter wall or fence construction.', 'Fence'),
  ('Excavation Clearance', 'Excavation', 'For earth-moving or digging projects.', 'Pickaxe'),
  ('Lot Survey Clearance', 'Lot Survey', 'For land area measurement and verification.', 'Map'),
  ('Water/MWSS Clearance', 'Water/MWSS', 'For water service connection applications.', 'Droplet'),
  ('PODA Clearance', 'PODA', 'For applicable PODA clearance requirements.', 'IdCard'),
  ('TODA Clearance', 'TODA', 'For tricycle operator and driver association requirements.', 'Bike'),
  ('Ambulant Clearance', 'Ambulant', 'For street vendors and mobile businesses.', 'ShoppingBag'),
  ('Lessor (Paupahan) Clearance', 'Lessor (Paupahan)', 'For rental property owners and landlords.', 'House'),
  ('Film Shooting Clearance', 'Film Shooting', 'For commercial or indie film production activities.', 'Clapperboard'),
  ('Products Promo Clearance', 'Products Promo', 'For product marketing and promotional activities.', 'Megaphone');
