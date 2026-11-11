-- Migration 17: in-app notices for Staff and Admin (FT-10) (IN PROGRESS, 2026-11-11).
--
-- jayemm01's PR #7 (merged 2026-11-11) sends Staff and Admin a notice when an application is submitted, a correction is
-- requested, a payment waits for checking, and a clearance waits for release (lib/teamNotifications.ts). Migration 9 only
-- allowed the six Applicant notice kinds, so every one of those inserts was refused ("notifications_event_check") and the
-- request that triggered it answered with an error after its own change was saved.
--
-- This replaces that rule with the six Applicant kinds plus the four team kinds. Nothing else changes: each person still
-- reads and marks read only their own notices (migration 10), and only the server writes them.
--
-- Re-runnable.

alter table public.notifications drop constraint if exists notifications_event_check;
alter table public.notifications add constraint notifications_event_check check (event in (
  'documents_flagged', 'application_returned', 'correction_resolved',
  'assessment_ready', 'payment_returned', 'clearance_ready',
  'submission_received', 'correction_requested', 'payment_pending', 'release_pending'
));

comment on table public.notifications is
  'In-app notices (not SMS). Applicants get notices about their own requests; Staff and Admin get team notices (new submission, correction requested, payment waiting, clearance waiting for release). Written only by the server; each person reads and marks read only their own. An unread notice with the same dedupe_key is updated instead of repeated.';
