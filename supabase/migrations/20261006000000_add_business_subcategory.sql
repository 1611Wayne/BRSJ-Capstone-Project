-- Add the Applicant's optional Ambulant / Lessor indication to applications
-- Generated 2026-10-06. Depends on 20260922000000_init_schema.sql.
-- Context: ../../../CHANGES.md, "Leader's push 1a584fd checked; D1 resolved..." entry,
-- decision D8.
--
-- WHY: the barangay office's own notes say Ambulant and Lessor are not separate
-- clearances ("SAKOP NG BUSINESS CLEARANCE YANG OPTIONS NA IYAN" — they are options
-- covered by Business Clearance). The agreed design (decision D8, 2026-10-06) is
-- that the Applicant may INDICATE which one applies when filing a Business
-- Clearance, and Staff make the FINAL determination of the Business Category and
-- Classification at assessment. The frontend already saves the indication
-- (applications.businessSubcategory); this gives it a home in the database.
--
-- WHAT THIS DOES NOT TOUCH: the Staff-decided category and classification. Those
-- stay on the assessment (assessments.business_category_id / classification_id),
-- because they are Staff's decision, not the Applicant's. This column is only the
-- Applicant's stated hint; nothing in fee calculation should read it directly.
--
-- NOT ENFORCED HERE, ON PURPOSE: that the indication is only used on Business
-- Clearance applications. A CHECK cannot look up the clearance type in another
-- table, and the frontend already clears the value for every other type; if a
-- database-level guarantee is ever wanted, it needs a trigger, not a CHECK.
--
-- NOT RUN YET: like 20261005000000_correct_clearance_types.sql, this has to be
-- pasted into the Supabase SQL Editor and confirmed.

alter table public.applications
  add column business_subcategory text
  check (business_subcategory in ('Ambulant', 'Lessor (Paupahan)'));

comment on column public.applications.business_subcategory is
  'Optional. What the Applicant indicated at intake for a Business Clearance: Ambulant or Lessor (Paupahan); NULL = Business Clearance only. A hint for Staff, not the final classification — that is decided at assessment.';
