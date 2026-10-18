# Schema map: frontend field → database column

**Status: IN PROGRESS.** Written 2026-10-06 from `Capstone-frontend/types/index.ts` and `lib/workflow.ts` as of the branch `feature/correction-requests` (commit `06489e7`). Its job is to stop the frontend and the database from drifting apart without anyone noticing. If you change a frontend type, change this file and add a migration in the same piece of work.

**Rules that keep it true**
1. Never edit a migration that has been run. Add a new, later-numbered one.
2. Every frontend type change (`types/index.ts`) gets a row here and, if it needs storing, a migration.
3. A new status, document state, or enum value has to be added to the matching `CHECK` list. The frontend and the database must list the same values.

## 1. Migration state

| # | File | Written | Run on the live project |
|---|---|---|---|
| 1 | `20260922000000_init_schema.sql` | 2026-09-22 | Yes |
| 2 | `20260923000000_correction_requests.sql` | 2026-09-23 | Yes |
| 3 | `20260923010000_seed_clearance_types.sql` (13 names) | 2026-09-23 | Yes |
| 4 | `20260923020000_rls_policies_profiles_applications.sql` | 2026-09-23 | Yes |
| 5 | `20261005000000_correct_clearance_types.sql` (13 → 9) | 2026-10-05 | Yes (2026-10-16) |
| 6 | `20261006000000_add_business_subcategory.sql` | 2026-10-06 | Yes (2026-10-16) |
| 7 | `20261006010000_sync_schema_with_frontend.sql` | 2026-10-06 | Yes (2026-10-16) |
| 8 | `20261016000000_receipt_confirmed_by.sql` (who confirmed a release at the counter) | 2026-10-16 | Yes (2026-10-16) |
| 9 | `20261016010000_notifications.sql` (in-app notices for Applicants) | 2026-10-16 | Yes (2026-10-17; confirmed by the after-check table the user pasted: 19 checks, ALL CHECKS PASSED) |
| 10 | `20261017000000_rls_policies_remaining_tables.sql` (who may read each table; three helper functions) | 2026-10-17 | Yes (2026-10-17; after-check table pasted by the user: all 19 checks true, ALL CHECKS PASSED) |
| 11 | `20261017010000_storage_buckets_and_policies.sql` (three private buckets and their read and upload rules) | 2026-10-17 | Yes (2026-10-17, same run) |
| 12 | `20261018000000_reference_numbers.sql` (`SJ-YYYY-######` made by the database: `reference_counters` + `next_reference_no()`, the default of `applications.reference_no`) | 2026-10-18 | Yes (2026-10-18; after-check pasted by the user: 20 checks, ALL CHECKS PASSED) |
| 13 | `20261018010000_sample_fee_schedules.sql` (**SAMPLE** fees from the prototype: 7 categories, 13 classifications, 23 schedules, 138 lines; `fee_schedules.created_by` may be NULL = loaded by the system) | 2026-10-18 | Yes (2026-10-18; after-check 21 checks, check 21 = 23 / 138). **Replace with the approved Revenue Code before real use.** |

**Files 5 to 8 were run on the live project on 2026-10-16** with the run kit below. The before-check matched (all row counts 0, 13 / 13 clearance types, three `false`) and the after-check returned all 15 checks `true` and **ALL CHECKS PASSED**, as reported by the user from the SQL Editor. **From now on do not edit files 1 to 8: add a new, later-numbered migration for any further change.** The run kit: **Easiest way (2026-10-16): the run kit in `run-on-supabase/`** — three files, three pastes: `1_before_check.sql` (read-only), `2_run_migrations.sql` (files 5 to 9 in one script, safe to run twice, also after an earlier version of the kit), `3_after_check.sql` (read-only; the last row says ALL CHECKS PASSED). Tested on a real Postgres engine in the live-like state (files 1–4 only), including a second run, the one-file-at-a-time path, and a check that the after-check fails on the old schema. File 6 was made re-runnable (`add column if not exists`) before it was ever run. Otherwise, run 5, 6, 7, 8 and 9 in that order in the Supabase SQL Editor. Files 1–7 were executed in order on a real Postgres engine (PGlite, Postgres 18) with 96 checks on the new constraints; file 7 was also run twice to prove it can be re-run. That is not the same as running it on Supabase, so report any error.

## 2. Field map

### `User` → `profiles` (+ Supabase Auth)
| Frontend | Database | Note |
|---|---|---|
| `id` | `profiles.id` = `auth.users.id` (uuid) | the frontend ids are strings like `resident-maria`; real ones are uuids |
| `firstName`, `lastName` | `first_name`, `last_name` | |
| `email` | `email` | contact only; the login is the phone number (SMS OTP) |
| `password` | **not stored** | Supabase Auth owns credentials |
| `role`, `status` | `role`, `status` | same values |
| `contact` | `contact_number` (unique) | kept in step with `auth.users.phone` by a trigger |
| `address`, `createdAt`, `privacyConsentAt` | `address`, `created_at`, `privacy_consent_at` | |
| `validId` | `valid_id_path` | the file lives in Storage; name, size and type are not kept in the table |

### `Application` → `applications`
| Frontend | Database | Note |
|---|---|---|
| `reference` | `reference_no` | made by the database on insert (migration 12: one counter per year, Manila time; never repeats; gaps are possible). Do not send it; the format is not enforced for explicit values (imports) |
| `residentId` | `resident_id` | |
| `applicant`, `address`, `purpose` | `applicant_name`, `address`, `purpose` | |
| `contact` | `contact_number` | |
| `clearanceType` (name) | `clearance_type_id` | look the name up in `clearance_types` |
| `dateRequested` | `date_requested` | |
| `status` | `status` | nine values, see section 4 |
| `businessName`, `businessLocation`, `businessContact` | `business_name`, `business_location`, `business_contact` | |
| `initialOperation` | `date_initial_operation` | |
| `applicationType`, `ownership`, `propertyOwner` | `application_type`, `ownership_type`, `property_owner_name` | |
| `source` | `source` | **stored again**, see trap 2 |
| `staffEncoder` | `staff_encoder_id` | **walk-ins only**, see trap 2 |
| `certified` | `certified` | |
| `hasEmployees`, `employeeCount` | `has_employees`, `employee_count` | NULL = not stated; count must be above 0 |
| `businessSubcategory` | `business_subcategory` | Applicant's hint only (decision D8) |
| `rejection.reason / rejectedBy / timestamp` | `rejection_reason`, `rejected_by`, `rejected_at` | all three or none; cleared when the request is reopened |
| `documents[]` | `application_documents` | below |
| `assessment` | `assessments` + `assessment_items` | below |
| `receipt`, `receiptPhoto` | `official_receipts` | below |
| `paymentVerification` | `payment_verifications` | below |
| `simulatedPayment` | `simulated_payments` | below |
| `clearance` | `clearances` | below |
| `confirmation`, `feedback`, `inspection` | `receipt_confirmations`, `feedback`, `inspection_reports` | below |
| `corrections[]` | `correction_requests` | below |

### `UploadedDocument` → `application_documents`
| Frontend | Database | Note |
|---|---|---|
| `requirement` | `requirement_name` | unique per application |
| `name`, `size`, `type` | `original_filename`, `file_size`, `mime_type` | max 5 MB |
| `status` | `verification_status` | `Pending Review` (default), `Verified`, `Missing`, `Needs Replacement` |
| `note` | `note` | Staff's optional reason, 200 characters |
| `url` | **not stored** | a signed link made from `storage_path` when needed |
| (the file) | `storage_path` | NULL only for a Missing placeholder |

A **Missing placeholder with no file** is a real row: when Staff correct an entry so that another document becomes required (Renter → Contract of Lease, Renewal → Old Business Clearance), the frontend adds that document as Missing, so the Applicant can upload it. **Replacing a document is an UPDATE of the same row** (new file, status `Pending Review`, note cleared). Who replaced it is in `audit_logs`.

### Assessment, payment and clearance
| Frontend | Database | Note |
|---|---|---|
| `assessment.category`, `.classification` | `assessments.business_category_id`, `classification_id` | names in the frontend; ids here; `''` → NULL |
| `assessment.total`, `.assessedBy`, `.assessedAt`, `.scheduleId` | `total_amount`, `assessed_by`, `assessed_at`, `fee_schedule_id` | `assessedBy` is a name in the frontend and a profile id here |
| `assessment.items[]` (name, amount, ordinance) | `assessment_items` (`fee_component_name`, `amount`, `ordinance_reference`) | a snapshot, so a later fee change never rewrites history |
| (Staff fee adjustment) | `assessment_items.scheduled_amount` | the schedule's own figure; NULL = not recorded (decision D9 open) |
| `receipt.orNumber`, `paymentVerification.orNumber` | `official_receipts.or_number` | **one place only**, unique across all applications; NULL until Staff type it |
| `receipt.orDate`, `.amountPaid` | `or_date`, `amount_paid` | both or neither; empty until Staff verify. **From 2026-10-16 the frontend fills both at verification:** `orDate` and `amountPaid` are typed by Staff from the receipt image; the amount must equal the assessed total |
| `receipt.recordedAt`, `.encodedBy` | `recorded_at`, `encoded_by` | whoever created the row |
| `receiptPhoto` (and `receipt.receiptPhoto`) | `receipt_photo_path`, `_filename`, `_mime_type`, `_size` | all four or none; max 5 MB |
| `paymentVerification.status` | `payment_verifications.status` | `Pending`, `Verified`, `Needs Correction` |
| `.submittedAt`, `.checkedBy`, `.checkedAt`, `.notes` | `submitted_at`, `checked_by`, `checked_at`, `notes` | `notes` is the return reason, required for Needs Correction |
| `simulatedPayment.method`, `.referenceNumber`, `.amount`, `.paidAt`, `.note` | `simulated_payments.method`, `reference_number`, `amount`, `paid_at`, `note` | DEMO ONLY; reference starts with `SIM-` |
| `clearance.issueDate`, `.generatedAt`, `.revisedFrom`, `.downloadedAt` | `clearances.issue_date`, `generated_at`, `revised_from`, `downloaded_at` | |
| `confirmation.timestamp` | `receipt_confirmations.confirmed_at` | `completionTime` is the same moment and is not stored twice |
| `confirmation.confirmedBy` | `receipt_confirmations.confirmed_by` (profile id) | the Staff member who recorded the release of the printed original at the counter (file 8); NULL when the Applicant confirmed themselves |
| `confirmation.ipPlaceholder` | `ip_address` | the frontend value is a placeholder text |
| `feedback.*` | `feedback.rating`, `comment`, `submitted_at` | `resident_id` comes from the application |
| `inspection.status`, `.inspector`, `.date`, `.remarks`, `.savedAt` | `inspection_reports.status`, `inspector_name`, `date_inspected`, `remarks`, `saved_at` | `saved_by` is the Staff member |

### Correction requests → `correction_requests`
| Frontend | Database | Note |
|---|---|---|
| `id` | `id` | |
| `message` | `message` | 500 characters at most |
| `requestedBy` (name) | `resident_id` | the Applicant who sent it |
| `requestedAt` | `created_at` | |
| `status` | `status` | `Open` or `Resolved`; only one `Open` per application |
| `resolvedBy`, `resolvedAt` | `resolved_by`, `resolved_at` | required when Resolved |
| `resolutionNote` | `resolution_note` | 300 characters at most |

### In-app notifications → `notifications`
| Frontend (`AppNotification`) | Database | Note |
|---|---|---|
| `id` | `id` | |
| `userId` | `user_id` | the Applicant who owns the request |
| `reference` | `application_id` | look the reference up in `applications` |
| `event` | `event` | six values: `documents_flagged`, `application_returned`, `correction_resolved`, `assessment_ready`, `payment_returned`, `clearance_ready` (the same names in both) |
| `message` | `message` | plain text, already worded for the Applicant |
| `key` | `dedupe_key` | while a notice is unread, a second one with the same key REPLACES it instead of adding another (a partial unique index enforces it); once read, the key may be used again |
| `createdAt`, `readAt` | `created_at`, `read_at` | NULL read_at = unread |

Wiring notes: the server writes these when Staff act (review, reject, resolve, assess, return payment, verify payment); an Applicant reads their own rows and marks them read (RLS policies are still to be written: `user_id = auth.uid()`). SMS is not stored here; if it is added, it should send the same events.

### Files → Storage (three PRIVATE buckets, migration 11)
| Bucket | Path | Database column | Who may read | Who may upload |
|---|---|---|---|---|
| `valid-ids` | `<profile uuid>/<file>` | `profiles.valid_id_path` | the owner of the folder; Staff; Admin | the owner into their own folder; Staff; Admin (a walk-in Applicant) |
| `application-documents` | `<application id>/<file>` | `application_documents.storage_path` | the owner of the application; Staff; Admin | the owner while the request is Draft, Pending Assessment or Under Review; Staff; Admin |
| `receipt-photos` | `<application id>/<file>` | `official_receipts.receipt_photo_path` | the owner of the application; Staff; Admin | the owner while Awaiting OR; Staff; Admin (at the counter) |

All three: 5 MB per file; PDF, JPG or PNG only; no public URL (open a file with a short-lived signed link). Objects are **write-once** from a user session (no update or delete rule): use a NEW file name for every upload (for example a timestamp prefix), so a replaced document or receipt keeps its earlier file. Uploading a file changes no record: the server still writes the table row, the status and the audit log.

### Who may read and write each table (migration 10)
Reading is scoped: an Applicant sees only rows of their own application (and their own notices); Staff and Admin see what their screens need; signed-out users see nothing. **Writing through a user session is closed on every table** except two things the Applicant needs: the files of their OWN DRAFT (`application_documents`: add, replace, remove; never Verified, no reviewer, no Staff note) and marking their OWN notices read (`notifications`; a trigger lets only `read_at` change, and only from empty). Everything else (assessment, payment check, clearance, confirmation, history, audit, notices, fee schedule) is written by the Next.js server routes with the service-role key, which bypasses these rules, so that the status rules and the audit log cannot be skipped. Exceptions in migration 4 (already run, not edited): Staff and Admin can update any application directly; review that when the frontend is connected.

### Other
| Frontend | Database | Note |
|---|---|---|
| `AuditLog` (`user`, `role`, `action`, `reference`, `oldValue`, `newValue`, `reason`, `reversion`, `timestamp`) | `audit_logs` (`user_id`, `role`, `action`, `reference_no` + `application_id`, `old_value`, `new_value`, `reason`, `reversion`, `created_at`) | see trap 1 |
| `TransactionReversion` | `transaction_reversions` (`action`, `reason`, `old_values`, `new_values`, `admin_id`) | |
| `FeeSchedule` (+ `items`) | `fee_schedules` + `fee_schedule_items` | ids differ (string vs serial); category and classification are names vs ids |
| status changes | `application_status_history` | the frontend has no separate list; it is in the audit log |

## 3. Wiring traps (read before connecting the frontend)

1. **Audit values.** The frontend puts plain text (`'Rejected'`, a correction message) and JSON text into the old/new value of an audit entry. `audit_logs.old_value` and `new_value` are `jsonb`. Plain text must be stored as a JSON string (`to_jsonb('Rejected'::text)`), and JSON text must be parsed first, or it ends up double-encoded.
2. **`source` and `staffEncoder`.** The frontend sets `staffEncoder` on every assessment, even for an online application. The database does **not** derive "walk-in" from it any more. `staff_encoder_id` is the Staff member who encoded a **walk-in**; the Staff member who assessed is `assessments.assessed_by`.
3. **One OR number, one place.** `official_receipts.or_number`. The frontend keeps a copy in `paymentVerification.orNumber`; do not store that copy. From 2026-10-16 Staff verification in the frontend also records the receipt itself (the OR number, OR date and Amount Paid Staff typed; the amount equals the assessed total), so a verified, non-simulated payment has all three. A verified, non-simulated payment must have an OR number: the database cannot check that across tables, so the application must.
4. **Evidence is either a receipt or a simulation, never both.** The frontend clears the other one on every submit. Do the same: delete the `simulated_payments` row when a receipt is submitted, and the other way round; delete it when Staff return the payment.
5. **Rejected requests.** A `Rejected` application must have a rejection (`rejection_reason`, `rejected_by`, `rejected_at`). Resolving the Applicant's correction request reopens it: set the status to `Pending Assessment` and clear all three. An Admin "Mark Under Review" reversion leaves them in place.
6. **Corrections cut-off.** The frontend accepts correction requests and Staff edits only while the status is `Pending Assessment`, `Under Review`, `Rejected`, `Awaiting OR` or `For Checking`. The database does not check this (it needs the application's status). After the clearance is generated, changes go through the Admin reversion.
7. **A correction can add a required document.** Insert the Missing placeholder in the same transaction as the edit.
8. **Lookups.** `clearanceType`, category and classification arrive as names; the database wants ids. Since migration 13 the category, classification and fee tables hold the prototype's **SAMPLE** values (marked SAMPLE in `ordinance_reference`), identical to `revenueCategories` and `mockFeeSchedules`; the server picks the effective schedule with the prototype's own `activeSchedule()` (`lib/server/feeSchedules.ts`). Replace them with the approved Revenue Code (new rows with a later effective date) before real use.

## 4. The status list (must match the frontend)

`Draft`, `Pending Assessment`, `Awaiting OR`, `For Checking`, `Ready for Download`, `Closed - Cleared`, `Under Review`, `Void`, `Rejected`.

## 5. Still not done (not schema drift, but not finished)

- Row Level Security **policies**: written for every table (migrations 4 and 10), tested on a real Postgres engine with real roles (96 checks, and four deliberately broken copies were each caught); **migrations 10 and 11 were run on the live project 2026-10-17** (after-check: no table with RLS but no policy, 3 private buckets, 6 storage rules).
- Storage buckets: created on the live project (migration 11, 2026-10-17); nothing uploads to them yet. Not covered: a bucket for generated clearance PDFs (`clearances.pdf_storage_path` exists; the app builds PDFs in the browser today); an immutable audit log (a trigger blocking update and delete; `audit_logs.application_id` uses ON DELETE SET NULL, so it needs care); clean-up of replaced files (a server job).
- Seed data for categories, classifications and fees.
- Decisions that could still change the tables: D5 (what a simulation may release; `simulated_payments`), D9 (may Staff adjust fees; `assessment_items.scheduled_amount`).
- Judgment calls in file 7 that the team has not confirmed yet are listed in the comment block at the top of that file.
