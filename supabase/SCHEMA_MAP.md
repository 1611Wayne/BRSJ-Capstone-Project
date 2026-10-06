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
| 5 | `20261005000000_correct_clearance_types.sql` (13 → 9) | 2026-10-05 | **No** |
| 6 | `20261006000000_add_business_subcategory.sql` | 2026-10-06 | **No** |
| 7 | `20261006010000_sync_schema_with_frontend.sql` | 2026-10-06 | **No** |

Run 5, 6 and 7 in that order in the Supabase SQL Editor. Files 1–7 were executed in order on a real Postgres engine (PGlite, Postgres 18) with 96 checks on the new constraints; file 7 was also run twice to prove it can be re-run. That is not the same as running it on Supabase, so report any error.

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
| `reference` | `reference_no` | format `SJ-YYYY-######` is not enforced in SQL |
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
| `receipt.orDate`, `.amountPaid` | `or_date`, `amount_paid` | both or neither; empty on the photo-only path |
| `receipt.recordedAt`, `.encodedBy` | `recorded_at`, `encoded_by` | whoever created the row |
| `receiptPhoto` (and `receipt.receiptPhoto`) | `receipt_photo_path`, `_filename`, `_mime_type`, `_size` | all four or none; max 5 MB |
| `paymentVerification.status` | `payment_verifications.status` | `Pending`, `Verified`, `Needs Correction` |
| `.submittedAt`, `.checkedBy`, `.checkedAt`, `.notes` | `submitted_at`, `checked_by`, `checked_at`, `notes` | `notes` is the return reason, required for Needs Correction |
| `simulatedPayment.method`, `.referenceNumber`, `.amount`, `.paidAt`, `.note` | `simulated_payments.method`, `reference_number`, `amount`, `paid_at`, `note` | DEMO ONLY; reference starts with `SIM-` |
| `clearance.issueDate`, `.generatedAt`, `.revisedFrom`, `.downloadedAt` | `clearances.issue_date`, `generated_at`, `revised_from`, `downloaded_at` | |
| `confirmation.timestamp` | `receipt_confirmations.confirmed_at` | `completionTime` is the same moment and is not stored twice |
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
3. **One OR number, one place.** `official_receipts.or_number`. The frontend keeps a copy in `paymentVerification.orNumber`; do not store that copy. A verified, non-simulated payment must have an OR number: the database cannot check that across tables, so the application must.
4. **Evidence is either a receipt or a simulation, never both.** The frontend clears the other one on every submit. Do the same: delete the `simulated_payments` row when a receipt is submitted, and the other way round; delete it when Staff return the payment.
5. **Rejected requests.** A `Rejected` application must have a rejection (`rejection_reason`, `rejected_by`, `rejected_at`). Resolving the Applicant's correction request reopens it: set the status to `Pending Assessment` and clear all three. An Admin "Mark Under Review" reversion leaves them in place.
6. **Corrections cut-off.** The frontend accepts correction requests and Staff edits only while the status is `Pending Assessment`, `Under Review`, `Rejected`, `Awaiting OR` or `For Checking`. The database does not check this (it needs the application's status). After the clearance is generated, changes go through the Admin reversion.
7. **A correction can add a required document.** Insert the Missing placeholder in the same transaction as the edit.
8. **Lookups.** `clearanceType`, category and classification arrive as names; the database wants ids. `business_categories`, `business_classifications` and the fee tables are **still empty** (the frontend hard-codes `revenueCategories`); seed them from real barangay data first.

## 4. The status list (must match the frontend)

`Draft`, `Pending Assessment`, `Awaiting OR`, `For Checking`, `Ready for Download`, `Closed - Cleared`, `Under Review`, `Void`, `Rejected`.

## 5. Still not done (not schema drift, but not finished)

- Row Level Security **policies**: only `profiles` and `applications` have them. The other 19 tables, including the two new ones, are deny-all through the API.
- Storage buckets for documents and receipt photos (the table only stores the path).
- Seed data for categories, classifications and fees.
- Decisions that could still change the tables: D5 (what a simulation may release; `simulated_payments`), D9 (may Staff adjust fees; `assessment_items.scheduled_amount`).
- Judgment calls in file 7 that the team has not confirmed yet are listed in the comment block at the top of that file.
