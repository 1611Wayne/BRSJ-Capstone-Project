# Mockup implementation map

The new screenshot files in `docs/mockup-reference` are the visual source of truth. Written business rules override misleading sample terminology in those screenshots.

| Mockup | Route / surface | Behavior |
| --- | --- | --- |
| 1 | / | Original two-column hero, local government-center image, apply and track links |
| 2 | / catalog and footer | 13 cards; working information, hours, privacy, and terms links; Treasury notice |
| 3 | /register | Registration, matching passwords, valid ID/type/size checks, required privacy consent |
| 4 | /login | Compact resident login and Staff/Admin login link; local credential checks |
| 5–6 | /clearance-types | 13 selectable cards and shared footer; selected type follows login into the form |
| 7–9 | /resident/apply | Official applicant/business field separation; conditional rental/renewal documents; draft and submission |
| 10 | /resident/apply/pre-assessment?ref=… | Available only after assessment; request-specific fees and downloadable slip |
| 11 | /resident/apply/or?ref=… | Required OR format/date/amount; exact assessed-amount match and duplicate detection |
| 12 | /resident/apply/ready?ref=… | Issued request preview, QR, sample PDF, download-before-confirmation gate |
| 13 | Feedback dialog | Only after receipt confirmation; 1–5 stars, optional comment, submit/skip return to applications |
| 14 | /resident/dashboard | Navy sidebar, state-derived summary cards, recent applications |
| 15 | /staff/applications | Queue tabs, search/type/date filters, empty state, pagination, correct per-status actions |
| 16 | /admin/fee-configuration | Editable lines, classification, schedule effective date, required ordinance, retained version history |
| 17 | /admin/transaction-reversion | Search, transaction modal, edit/void/review, reason and immutable old/new audit snapshots |
| 18 | /staff/walk-in | Existing-resident search or local resident creation; shared application form and walk-in source |
| 19 | /resident/applications | Resident-owned history, draft continuation, assessment/OR/download/details actions |
| 20 | /verify/[reference] | Public fields only; valid/revised/void/review/not-found states for issued records |
| 21 | /admin/reports | Three report cards with working View Report links |
| 22 | /admin/reports/daily-or | Applied date/type filters, OR count and recorded total, CSV and Print |
| 23 | /admin/reports/reversion-audit | Applied date/user/action filters, preserved old/new values, CSV and Print |
| 24 | /admin/users | Resident/Staff tabs, search, create/edit/reset/deactivate/activate, audit entries |

Supporting screens:

- `/staff/assessment/[id]`: document review, automatic category/scale fees, assessment confirmation, inspection save.
- `/staff/assessment`: assessment selection from the queue.
- `/staff/or-entry`: assisted OR entry using the same OR gate.
- `/staff/transactions`: processed requests.
- `/resident/applications/[id]`, `/staff/applications/[id]`, `/admin/applications/[id]`: application detail, local documents, assessment and receipt data; Staff/Admin processing milestones.
- `/admin/transactions`: all submitted requests.
- `/admin/reports/monthly-collection`: applied month/year/type filters; transaction, assessed, and recorded OR totals; CSV and Print.
- `/admin/dashboard`: application metrics, OR-to-generation processing/SLA, feedback average, recent audit activity.
- `/admin/audit-trail`: all service and administrative audit entries.
- `/resident/profile`: editable profile saved to the local mock user.
- `/track`: private tracking through authenticated My Applications.
- `/information`: contact/office information, prototype privacy notice, and terms.

Visual correspondence is implemented from the supplied images and existing layout. Pixel-difference or browser interaction testing was not requested or performed.
