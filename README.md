# Barangay San Jose Clearance Portal

Frontend prototype for **Streamlining Barangay Clearance Services: A Web-Based Assessment System for Barangay San Jose, Rodriguez, Rizal Using ITIL 4 Service Request Management Principles**.

## Run

Dependencies are installed. From this directory:

```powershell
npm.cmd run dev
```

Open http://localhost:3000. On systems without PowerShell execution-policy restrictions, `npm run dev` also works.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```

## Demo accounts

| Login area | Email / username | Password |
| --- | --- | --- |
| Resident | maria@example.com | resident123 |
| Resident | juan@example.com | resident123 |
| Staff/Admin | staff@san-jose.gov | staff123 |
| Staff/Admin | admin@san-jose.gov | admin123 |

Use the **Staff/Admin Login** link below the normal login form for staff and admin accounts. Credentials are checked against local mock users. Accounts created or reset through the interface work within the same browser-tab session.

## Complete demonstration

1. Log in as Maria. Choose a clearance, complete the required form, attach sample JPG/PNG/PDF files, certify the information, and submit. Save Draft also works.
2. The request gets a unique reference and remains **Pending Assessment**. It cannot proceed to fees or OR entry.
3. Log out and log in as Staff in the **same tab**. Open the Applications Queue, review the request's documents, select the business category and classification, and confirm assessment. Standard fee amounts come from the effective fee schedule.
4. Save an inspection report if desired. Staff can also select or create a resident in **New Walk-in Application**, which reuses the resident form and records the source as **Assisted / Walk-in**.
5. Return to Maria's login in the same tab. Open **My Applications → View Assessment** and download the sample Pre-Assessment Slip.
6. Enter a unique sample OR number such as **TR-2026-54321**, an OR date in 2026 that is not in the future, and the exact displayed assessed amount.
7. Download the sample clearance PDF. This enables **Confirm Receipt**. Confirmation records the time and IP placeholder, closes the request, and opens the optional feedback modal.
8. Log in as Admin to change fee schedules, review retained versions, correct / void / mark transactions under review, manage resident/staff accounts, and view reports.
9. Report filters apply to the shared records. Export produces CSV; Print uses the browser's print dialog.

Maria's seed records include pending, awaiting OR, ready-for-download, and closed requests. Juan's requests are visible only in his resident account and to staff/admin.

Public verification example: **/verify/SJ-2026-000125**. Unknown or unissued references return Record Not Found. Reversions change issued records to Revised, Void, or Under Review as applicable. Public verification renders only the reference, clearance type, issue date, and status.

## Source of truth and prototype boundaries

- The 17 supplied screenshots are in **docs/mockup-reference/**. Their layouts, compact forms/cards, tables, and modal styling guide the implementation. The current orange, gold, warm brown, and cream palette follows the Barangay seal. The older paper mockups were not used.
- **docs/implementation-map.md** maps every requested mockup to the route and behavior.
- The official business applicant fields follow the supplied written brief. Business Category and Classification appear only in staff assessment and admin fee configuration.
- No official form scans, approved Revenue Code document, or capstone SLA specification are included in this workspace. Fee values and the **60-second OR-entry-to-generation SLA** are explicitly illustrative. Other clearance types use the supplied generic property/activity fields pending their approved official forms.
- This is **Next.js App Router, React, TypeScript, Tailwind CSS, and Lucide React**, plus a small QR generator. There are no API routes, database connections, authentication services, payment integrations, or remote file storage.
- React Context holds the state and sessionStorage retains the demonstration across navigation, logout/login, and refresh in the same tab. Closing the tab ends the session; a fresh session loads seed data. Browser session restoration may retain the tab's state.
- Uploads remain local object URLs in memory; only file metadata is placed in sessionStorage. File previews do not survive a page refresh. Seed documents contain fictional metadata; their View action explains this and offers a sample document.
- Role checks demonstrate frontend behavior only. The browser contains the mock datasets and credentials; this is not production security.
- QR codes point to the current portal origin and verification route. Changes exist only in the current tab session; another browser/device sees its own seed state, and a localhost URL is reachable only on the serving computer.
- All downloaded PDFs are watermarked **SAMPLE ONLY — NOT AN OFFICIAL DOCUMENT**. The portal does not collect payments, issue Official Receipts, or verify a Treasury database. Payments in the proposed workflow occur at the Municipal Treasury.
- Password reset changes the local mock credential and never records passwords in audit entries. No email is sent.

## Structure

- `app/globals.css`: shared seal-inspired palette in `:root`; change these variables to adjust colors throughout the portal. `tailwind.config.ts` exposes `brand-*` utilities and warm neutral shades. Status badges retain distinct semantic colors.
- `app/`: public, resident, staff, admin, and report routes.
- `components/`: shared navigation, role gate, application form, tables, assessment, OR/download workflow, uploads, QR, and accessible native-dialog modals.
- `data/`: clearance catalog, sample Revenue Code categories, fee schedules, users, applications, audits, and report aggregation.
- `types/index.ts`: shared models for requests, roles, documents, assessment, fees, ORs, clearances, confirmation, feedback, reversions, and reports.
- `lib/workflow.ts`: role checks, form and OR validation, fee selection, state transitions, and audit recording.
- `lib/downloads.ts`: local CSV and PDF generation, including a scannable verification QR in clearance PDFs.
- `tests/workflow.test.cjs`: 16 scenario tests across the complete workflow, permissions, validation, reporting, and PDF structure.

## Validation

The production build compiles all routes and checks TypeScript. Workflow tests use Node's built-in test runner and the existing TypeScript compiler; no test framework dependency is required.

Browser interaction / pixel-difference testing has not been performed. Responsive navigation, horizontal table overflow, native dialog focus containment, accessible input labels, keyboard focus indicators, and print styles are implemented in the source.
