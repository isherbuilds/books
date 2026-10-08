# Spec: Product family — Books, School and HMS on one Finance core

Status: ready
Authority: founder decision, 2026-10-08 (this conversation): one SaaS, one
database, one app with modules turned on per Organization.
Supersedes: the 2026-09-13 decision to keep HMS and Books as separate apps that
exchange export files. [Accounting core](./accounting-core.md) call 14 changes
from "Operations lives outside this repository" to "Operations lives in module
directories in this repository". Visual companion: [product-family.html](./product-family.html).

## Problem

The founder runs three apps — Books, School (`~/accly-ai/school`) and HMS
(`~/accly-ai/hms`) — on one stack. Each app is a hand-made copy of the same
platform (auth, UI, storage, audit), and the copies already differ. Money is
recorded twice:

- School keeps its own fee ledger.
- HMS keeps its own double-entry ledger.
- Books would be a third ledger, fed by export files.

The owner cannot see live figures without a sync. The CA reconciles two ledgers
for one legal entity. Every platform fix is made three times.

## Solution

One SaaS at one domain. Every customer is an Organization at
`example.com/<org-slug>`, and all customers share one PostgreSQL database. One web
build and one server build serve every Organization.

- **Finance** (Billing plus General Accounting, the code Books has today) is
  always on.
- **School** and **HMS** are modules. Each Organization turns on one, both or
  neither. A rental business or a personal ledger turns on none.
- A module never keeps money records of its own. When the School office collects
  a fee, School calls the Finance command that posts a Receipt, inside the same
  database transaction. The fee screen, the party statement and the balance sheet
  agree immediately.
- Finance never imports a module, and modules never import each other.

## Validation / Evidence

Owner-funded internal work: the founder's own school, hospital and rental
entities are the first users. Market evidence stays in
[validation](../validation/). No module goes to an outside customer before its
pilot gate.

- School is not in production and has no data to migrate. It is the proof
  module.
- HMS is close to its pilot month and has its own ledger. It joins after its
  pilot (see Explicitly Deferred).

## Scenarios

1. **Before:** a parent pays ₹12,000 tuition. School writes a fee receipt and
   its own fee ledger. The CA later imports a CSV into Books or Tally.
   **After:** School posts a Finance Receipt against the term Invoice in the
   same transaction. Books shows it at once on the Day Book and the student's
   party statement.
2. **Before:** the owner opens School for collections and Books for the balance
   sheet. The two disagree until someone imports.
   **After:** both read one set of documents. They cannot disagree.
3. **Before:** an accountant cancels an imported fee receipt in Books, and School
   still shows it as paid.
   **After:** Books refuses to cancel a document that School created and names
   School as the place to correct it. School's void calls the Finance cancel
   command, so both views change together.
4. **Before:** a rental business and the school live in separate apps with
   separate logins.
   **After:** one login. The member switches Organization. A rental Organization
   with no module sees only Books.
5. **Before:** a teacher has a School login and no Books access.
   **After:** a teacher is a Member with the `teacher` role. The role grants
   School statements only, so a teacher never sees Finance screens, and an
   accountant never sees students' attendance unless granted.

## Screens / Flows

**Design direction.** Books' design system is the direction: [Design](../design.md)
and the tokens in `packages/ui/src/styles/globals.css`. The visual companion copies
those tokens and the real shell, `DataTable`, inset Sheet and `Badge`. Ported School
screens keep their layout and use Books tokens; School's tone colours map to
Books' four state meanings. Each key screen states its one job:

- **S1 (F1) Create organization:** the founder sets the modules once; the copy
  says the choice is permanent. Proposed: a Modules section under the existing
  fields, with Hospital shown as not available yet.
- **S2 (F1, F3) Org shell:** the School group appears only when the module is on.
  Proposed: the group sits after Accounting, so Books rows never move. Students
  list balances come from the Party (R3.1).
- **S3 (F3) Collect fees:** School's collection desk (charges, then Payment)
  with Ready, Over payable and Collected states. Collected lists every Receipt
  number (R3.7).
- **S4 (F2) Books Receipt Sheet:** today's Sheet with a neutral "From School"
  badge and, in place of Cancel, the footer note "Cancel this in School › Fees."

### F1. Module switch

- **R1.1** `organization_settings.modules` holds the Organization's modules: a
  set drawn from `school` and `hms` (the list lives in the application, not a
  CHECK). Empty means Books only.
- **R1.2** The founder's Create organization form (`/create`) sets the modules.
  Nothing changes them afterwards (see Explicitly Deferred).
- **R1.3** `member.me` returns the modules. The app shell shows a module's
  navigation group only when the Organization has that module.
- **R1.4** Each permission statement belongs to Finance or to one module.
  `orgProcedure` refuses a statement whose module is off: `FORBIDDEN` with
  `params.reason: MODULE_OFF`. This check runs in the same guard as the role
  check, on the one membership read, and is audited the same way.
- **R1.5** A module route under `/$orgSlug/<module>/` returns not-found when the
  module is off.

### F2. Document source

- **R2.1** `documents.source` records who created a Document: `user`, `school`
  or `hms`. Finance screens and procedures create `user` documents. A module
  command passes its own name.
- **R2.2** A Finance cancel procedure refuses a document whose source is not
  `user`: `CONFLICT` with `params.reason: SOURCE_OWNED` and the message "Cancel
  this in School." (or HMS). The record Sheet shows "From School" and has no
  Cancel action.
- **R2.3** The module calls the same Finance cancel command with its own
  source, so the reversal, period-lock and allocation rules stay in one place.
- **R2.4** Allocations, reports, statements and exports treat every source the
  same.

### F3. School module (proof)

Screens port from School and keep their current design: students, enrollment,
academics, attendance, fees and messaging. Platform screens (sign-in, members,
roles, audit, files, settings, onboarding) are Books'. School's `todo`, AI chat
and `prototypes` routes are template code; they are not ported.

- **R3.1 Student is a Party.** Admission creates a customer Party in the same
  transaction and stores `student.partyId`. Fee figures are read from the
  Party.
- **R3.2 Fee head is an Item** with an income Account and the GST-exempt tax
  code. `fee_head.ledger_account` goes; the Item's income Account replaces it.
- **R3.3 Fee structures stay in School.** They are templates.
- **R3.4 Generate demands** posts one Invoice per enrollment per period, with one
  line per fee head, source `school`, no draft. School keeps one link row per
  Invoice: `fee_demand (orgId, enrollmentId, periodLabel, documentId)`, unique
  on `(orgId, enrollmentId, periodLabel)`. A second run for the same period
  skips rows that exist. The Invoice's state is the only status.
- **R3.5 Cancel a demand** calls the Finance Invoice cancel command. A demand
  with active receipts is refused by Finance's existing allocation rule.
- **R3.6 Concession** posts a Credit Note against the demand Invoice line,
  source `school`, with the reason as narration.
- **R3.7 Collect fees** posts one Receipt `against` per payment leg (cash, UPI,
  cheque, bank: up to four), each allocated to the selected Invoices, in one
  transaction. A collection may not exceed the selected outstanding; School
  holds no unapplied credit (School ADR 0017). School stores
  `fee_receipt (orgId, documentId, collectionId, studentId)` and prints one slip
  per collection listing each Receipt number.
- **R3.8 Void a collection** cancels each of its Receipts through the Finance
  cancel command in one transaction. The correction flag moves to `fee_receipt`.
- **R3.9 Ledger, today's collection and defaulters** read Finance: party
  statement, Receipts by date and party balances. `fee_ledger_entry`, `receipt`,
  `receipt_payment`, `receipt_line` and `receipt_counter` are not ported. Receipt
  numbers come from Finance's Receipt Number Series.
- **R3.10 Roles.** School's `admin`, `frontoffice` and `teacher` join
  `access.ts` beside `owner`, `accountant`, `ca` and `operator`, and still
  authorize as a union. `frontoffice` grants School fee statements; the School
  procedure's grant authorizes the Finance command it calls, which does not
  re-check Finance grants. The teacher's section limit
  (`section-scope`) ports with School.

### Shared rules

- Every module table carries `orgId NOT NULL`, and every query carries the
  tenant predicate (hard rule 1). A module row that references a Document uses a
  composite key `(orgId, documentId)`.
- A module calls Finance only through the exported command functions that take
  `(tx, scope, settings, input)`. `postReceipt` is the prior art, and
  `invoice.post` already calls it in-process.
- Finance commands never call `audit()`; the module's procedure audits after
  commit (hard rule 3).

## Implementation Decisions

- **Home repository:** this one. Package names stay `@accly/*`. School code is
  ported file by file onto Books' platform packages, not git-merged. After F3 is
  verified, the School repository is read-only. HMS stays in its own repository
  until its gate.
- **Layout.** Module code lives in directories, not new packages, because one
  build serves every Organization:
  - schema: `packages/db/src/schema/school/`
  - API: `packages/api/src/school/` (domain) and `packages/api/src/routers/school/`,
    mounted as `appRouter.school`
  - web: `apps/web/src/routes/$orgSlug/school/`
  - tests: `tests/integration/school/`
- **Import direction** is enforced by `no-restricted-imports` overrides in
  `.oxlintrc.json`. Finance code (`packages/api/src/{core,lib,routers}` outside
  module directories) may not import `school/` or `hms/`. `school/` may not
  import `hms/`, and `hms/` may not import `school/`. Add the row to the AGENTS.md
  rule-enforcement table.
- **Finance commands.** Extract `postInvoice`, `postCreditNote` and the cancel
  path of Receipt, Invoice and Note into exported
  `(tx, scope, settings, input)` functions beside `postReceipt`. Each command
  takes `source`. Routers call them with `user`. This is a move of handler
  bodies, not a new layer.
- **Schema.** Add `documents.source` (text, not null, default `user`) and
  `organization_settings.modules` (text array, not null, default empty). Regenerate
  the baseline with `bun run db:generate` and reset (hard rule 4; pre-production).
- **Module guard.** `access.ts` exports the module of each statement. The
  membership read in `orgProcedure` joins `organization_settings.modules`. No
  second procedure builder.
- **General Accounting is not switchable.** Every document posts to the ledger.
  An Organization that keeps Tally ignores the accounting screens and uses the
  exports. A switch waits for a customer who needs one.
- **Deployment** stays as it is: one web and one server image, one PostgreSQL,
  in an Indian region. A customer who demands a dedicated database later gets the
  same build on its own deployment; no code supports this now.

## Test Seams

- **Procedures through the oRPC client** (`tests/support/client.ts`), as every
  integration test does now:
  - module off → `MODULE_OFF`
  - `SOURCE_OWNED` cancel refusal from Books
  - School collect fees → Finance Receipt, allocation and party balance in one
    transaction; a forced failure after the Receipt leaves no Receipt and no
    `fee_receipt`
- **`tests/integration/tenancy.test.ts`** gains the School procedures and tables.
- **`tests/unit/access.test.ts`** gains the union of a Finance role and a School
  role, and the statement-to-module map.
- School's ported tests replace their own fee-ledger assertions with Finance
  reads. Do not port tests of removed tables.

## Task Plan

- [ ] **Slice 1: Module switch and document source** (riskiest seam: the guard
      every module request crosses)
  - Acceptance: R1.1–R1.5 and R2.1–R2.4 hold. A Books-only Organization sees no
    module navigation. A `user` document cancels as today.
  - Verify: `bun run check-types`; `bunx oxlint`; `bun run test` (owns
    `accly_test`); runtime check per AGENTS.md at 1440 and 390 px.
  - Depends on: none
  - Owns/Touches:
    - `packages/db/src/schema/{documents,organization-settings}.ts`
    - `packages/db/drizzle/` (regenerated)
    - `packages/auth/src/access.ts`
    - `packages/api/src/lib/procedures/factory.ts`
    - `packages/api/src/routers/{receipt,invoice,note,payment,bill,journal,member}.ts`
    - `packages/api/src/core/documents.ts`
    - `packages/api/src/routers/organization.ts` and `apps/web/src/routes/create.tsx`
    - `apps/web/src/components/app-shell.tsx`
    - the receipt, invoice and note record Sheets
    - `tests/integration/{tenancy,receipt,core}.test.ts`
    - `tests/unit/access.test.ts`
  - Interfaces:
    - produces `type Module = "school" | "hms"`
    - produces `MODULE_OF: Record<statement, Module | null>`
    - produces `postInvoice(tx, scope, settings, input & { source })`
    - produces `postCreditNote(tx, scope, settings, input & { source })`
    - produces `cancelDocument(tx, scope, { documentId, source })`
    - produces `postReceipt` with an added `source`
    - produces `member.me` returning `modules`
- [ ] **Slice 2: School core onto the platform**
  - Acceptance: academics, students (admission creates a Party, R3.1),
    enrollment, attendance and messaging work under
    `/$orgSlug/school/` with Books' sign-in, members and roles (R3.10). The
    import-direction lint passes. Todo, AI chat and prototypes are absent.
  - Verify: the Slice 1 gates; School's ported integration tests; runtime check
    signed in as owner and as a seeded `teacher`.
  - Depends on: Slice 1
  - Owns/Touches:
    - `packages/db/src/schema/school/`
    - `packages/api/src/school/` and `packages/api/src/routers/school/`
    - `apps/web/src/routes/$orgSlug/school/`
    - `tests/integration/school/`
    - `.oxlintrc.json`
    - `packages/auth/src/access.ts` (School roles)
    - seed scripts (a School Organization and a teacher)
  - Interfaces:
    - consumes `MODULE_OF` and `type Module`
    - produces `student.partyId` and `appRouter.school.*`
- [ ] **Slice 3: School fees on Finance**
  - Acceptance: R3.2–R3.9. Scenario 1 shows the Receipt on the Day Book and the
    student's statement with no sync. Scenario 3 refuses the Books cancel with
    `SOURCE_OWNED`, and the School void reverses it. A failed collection leaves
    no partial rows.
  - Verify: the Slice 1 gates; the new fee integration tests; runtime check:
    generate demands, grant a concession, collect a split cash and UPI payment,
    void it, then compare the party statement and trial balance at 1440 and
    390 px in both themes.
  - Depends on: Slice 2
  - Owns/Touches:
    - `packages/db/src/schema/school/fees.ts`
    - `packages/api/src/school/fees*.ts` and `packages/api/src/routers/school/fee.ts`
    - `apps/web/src/routes/$orgSlug/school/fees/`
    - `tests/integration/school/fees.test.ts`
  - Interfaces:
    - consumes `postInvoice`, `postCreditNote`, `postReceipt` and
      `cancelDocument` with `source: "school"`, plus `partyStatement`
- [ ] **Slice 4: Documents follow the code**
  - Acceptance:
    - [Architecture](../architecture.md) gains a Modules section.
    - [Accounting core](./accounting-core.md) call 14 names module directories.
    - `CONTEXT.md` gains Module and updates Source.
    - [Product](../product.md) states one SaaS with modules.
    - AGENTS.md maps the module directories and the lint row.
    - The work registry lists this spec.
  - Verify: `bunx oxfmt --check docs CONTEXT.md AGENTS.md`; links resolve.
  - Depends on: Slice 3
  - Owns/Touches: those documents only.
  - Interfaces: none

## Out of Scope

- HMS code changes. HMS keeps its own repository and ledger until its gate.
- A database per customer, sharding and on-premises installs.
- Offline sync and the client sync engine.
- Personal income tax filing (Product B).
- Cross-Organization consolidated reports.

## Explicitly Deferred

- **HMS module.** Gate: HMS pilot month complete and Slice 3 verified. Its own
  spec ports HMS as `hms/` directories. The spec maps these HMS records onto
  Finance documents:

  | HMS today               | On Finance        |
  | ----------------------- | ----------------- |
  | Invoice                 | Invoice           |
  | Payment                 | Receipt           |
  | Advance receipt         | Receipt `advance` |
  | Refund                  | Payment (refund)  |
  | Credit note             | Credit Note       |
  | Payer and patient payer | Party             |

  Unbilled Charges, stock and the clinical records stay in HMS. HMS deletes
  `accounts`, `journal_entries`, `journal_lines`, `ledger.ts` and its trial
  balance and balance sheet reports. The same spec decides how pilot data
  moves: carry it over or close the pilot books at a cutover date.

- **Changing modules after go-live** (cutover date, opening balances, open
  documents). Gate: a live Organization asks for it.
- **General Accounting switch per Organization.** Gate: a paying customer who
  keeps Tally and must not see accounting screens.
- **Per-Organization export and restore.** Gate: before the first outside paying
  customer.
- **PostgreSQL row-level security as a second tenant guard.** Gate: before the
  first outside paying customer, or a tenancy defect.
- **Several payment legs on one Receipt.** Gate: the school office reports that
  one Receipt number per leg confuses parents.
- **External ingestion** (`externalRef`, API keys) for systems outside this
  repository stays post-MVP ([accounting core](./accounting-core.md) call 8).

## Open Questions

None.
