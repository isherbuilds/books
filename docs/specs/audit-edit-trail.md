# Spec: Edit trail for parties, accounts, items and settings

Status: ready
Authority: owner decision, 2026-10-09. Close the audit-trail gaps in master data
and settings found against the MCA edit-log rule (Companies (Accounts) Rules,
rule 3(1) proviso, in force 1 April 2023). `audit()` stays fire-and-forget
([hard rule 3](../../AGENTS.md#hard-rules)) until a customer needs a stronger
guarantee.
Supersedes: none. [Visual companion](./audit-edit-trail.html).

## Problem

The audit log records posts, cancellations, allocations, locks, members and
files. It does not record who created or changed a party, an account or an
item. For settings, it records that someone saved them but not what changed. A
CA reading the log cannot answer "who changed this customer's GSTIN, and from
what?"

Posted documents need no new trail. They never change, and a correction is a
cancellation or an amendment, which the log already records.

## Solution

Each create, edit and status change of a party, an account or an item writes an
audit row. Each edit stores the fields that changed, with the old and the new
value. A settings save stores its changes the same way. The Audit page shows
each change as `Field: old → new`.

## User Stories

1. As an owner, I want to see who changed a party's GSTIN and its old value, so
   that I can find the cause of a wrong tax invoice.
2. As a CA, I want every change to a ledger name, item price or setting in the
   log, so that the books meet the edit-log rule.
3. As an owner, I want a save that changes nothing to add no entry, so that the
   log shows only real changes.

## Screens / Flows

**Design direction:** the existing Audit page (`settings/audit.tsx`) and the
tokens in `packages/ui/src/styles/globals.css`. No new component, colour or
layout. The Details column already holds prose; it now holds the changes.

### A1 — Audit page (Settings → Audit)

Job: answer "who did what, and what changed". The one thing it makes obvious:
the old and the new value of each changed field.

- **R1** An edit row's Details lists each changed field as `Label: old → new`,
  in the order the record's form shows them, separated by `·`. An empty old
  or new value shows `—`. `true` and `false` show `Yes` and `No`, in `changes`
  and in the top-level `active` of every `setActive` row. A list
  (party roles) shows its items joined by `, `.
- **R2** New action labels: `party.create` "Party created", `party.update`
  "Party changed", `account.create` "Account created", `account.update`
  "Account changed", `item.create` "Item created", `item.update` "Item
  changed", `item.setActive` "Item status changed", `paymentMethod.create`
  "Payment method created", `paymentMethod.setActive` "Payment method status
  changed".
- **R3** The On column shows the record's name (`meta.name`), as it does today
  for any row with a name. Searching that name finds the row (the existing
  search reads top-level `meta` values).
- **R4** The page description reads "Changes to your books, records and
  settings, and every permission denial".
- **R5** Rows written before this change render as they do today. One
  exception: an old `account.setActive` row (`{ active }`) shows
  `Active: Yes` or `Active: No` (R1).

### F1 — Writing the trail (server)

- **R6** `party.create`, `account.create`, `item.create` and
  `paymentMethod.create` write one audit row after commit: target `party:<id>`
  (or `account:`, `item:`, `paymentMethod:`), meta `{ name }`.
- **R7** `party.update`, `account.update`, `item.update` and `settings.update`
  write one row after commit with meta
  `{ name, changes }`. `changes` maps each changed field to `[old, new]` and
  holds only fields whose value differs. For `settings.update`, `name` is the
  legal name. An `account.update` can clear `taxCode` on linked items (the
  supply class of an unused income account leaves `taxable`). Then `changes`
  also holds `clearedItemTaxCodes: [["<item name>: <tax code>", …], []]`.
  R1 renders it as `Cleared item tax codes: Widget: GST18, … → —`. The update
  reads these item rows `FOR UPDATE` inside its transaction, before it builds
  and clears the list, so no concurrent `item.update` can change them. The row
  is written after commit like the rest.
- **R8** A save in which no field changed writes no row.
- **R8a** `item.setActive` and `paymentMethod.setActive` follow the existing
  `account.setActive` row: meta `{ name, active }`, written on every success.
  `account.setActive` adds `name`. Details reads `Active: No`.
- **R9** A refused write (stale edit token, validation error, permission
  denial) writes no success row. Role denials stay as today.
- **R10** Values are stored as people read them: money as `formatDecimal`
  output (`1250.00`, as posted rows already store amounts) under a key
  without `Paise` (`unitPrice`, `mrp`); a reference as the
  referenced name (`incomeAccount`, not `incomeAccountId`); everything else as
  stored. `normalizedName`, `updatedAt` and ids are never stored.
- **R11** Audit stays fire-and-forget. A failed audit write is logged and never
  fails or slows the edit.

## Implementation Decisions

- **One diff helper.** `auditChanges(before, after)` in `packages/db/src/audit.ts`
  (beside `audit()`) takes two plain records of `AuditValue` with the same keys
  and returns the `[old, new]` pairs that differ, comparing arrays by item.
  Callers map their rows to readable records (R10) before calling it. Returns
  `undefined` when nothing changed, so a caller skips `audit()` (R8).
- **Status changes.** The three `setActive` procedures return the row's name
  from their update (`returning`), so they need no extra read.
- **Old values.** Each update reads the row inside its transaction under the
  same edit-token predicate it already updates with, before the update. A
  missing row is the existing `STALE_RECORD` / `CONFLICT` refusal. Account
  update already reads the row when the supply class changes; it reads it on
  every call instead. `settings.update` already reads `current` FOR UPDATE.
- **Item income account.** `item.update` records the income account by name.
  The old and new names come from the accounts table in the same transaction.
- **Rendering.** `describeMeta` in `settings/audit.tsx` renders the `changes`
  key per R1 and keeps today's output for other keys, with two exceptions.
  On every row written under R6, R7 or R8a (chosen by action), the top-level
  `name` feeds only the On column (R3) and search, not the Details cell. Other
  rows that store `{ name }` (file upload and delete) keep today's Details
  (R5). A top-level boolean (`active`) shows `Yes` or `No` (R1, R5). Field
  labels use the
  existing camelCase-to-words rule plus the existing GSTIN/TDS fixes, and add
  PAN, PIN and HSN/SAC.
- **No schema change.** `audit_log.meta` already holds nested values.
- **Docs.** Slice 2 updates `docs/architecture.md` "Audit and files": it lists
  the new events, states that edits store changed fields, and names
  master-data edits to financial and tax records as sensitive actions under
  [hard rule 3](../../AGENTS.md#hard-rules) (MCA edit-log). It also changes
  the line that audit covers "never reads or ordinary writes" to agree.

## Test Seams

The oRPC router through the existing integration harness, reading `audit_log`
after `drainAuditWrites()`, as `tests/integration/lock.test.ts` does.

- `tests/integration/account.test.ts`: one happy path. Renaming an account
  writes `account.update` with `changes: { name: [old, new] }` and nothing
  else.
- Same file: one failure path. A stale `account.update` (refused
  `STALE_RECORD`) writes no `account.update` row.
- `auditChanges` gets no separate unit test; the integration path proves it.
- The Audit page rendering is checked in the running app (A1).

## Task Plan

- [ ] **Slice 1 — Account trail, end to end (proof slice)**
  - Acceptance: creating an account writes `account.create`; renaming it shows
    "Account changed" and `Name: Sales → Sales — Services` on the Audit page; a
    save with no change adds no row; a stale save adds no row.
  - Verify: `bun run test` (wipes `accly_test`; one session owns the run),
    `bun run check-types`, `bunx oxlint`; Audit page in the
    running app at 1440 and 390 px, light and dark.
  - Depends on: none.
  - Owns/Touches: `packages/db/src/audit.ts`,
    `packages/db/src/schema/audit.ts` (`account.create`, `account.update` in
    `AuditAction`), `packages/api/src/lib/document-labels.ts`
    (`AUDIT_ACTION_LABELS`), `packages/api/src/routers/account.ts`,
    `apps/web/src/routes/$orgSlug/settings/audit.tsx` (rendering),
    `tests/integration/account.test.ts`.
  - Interfaces: produces
    `auditChanges(before: Record<string, AuditValue>, after: Record<string, AuditValue>): Record<string, [AuditValue, AuditValue]> | undefined`
    and exports the `AuditValue` type from `packages/db/src/schema/audit.ts`;
    `describeMeta` renders `meta.changes`.

- [ ] **Slice 2 — Parties, items and settings**
  - Acceptance: R6–R10 hold for `party.create/update`,
    `item.create/update/setActive`, `paymentMethod.create/setActive`,
    `account.setActive` (name added) and `settings.update`. Changing a party's
    GSTIN shows `GSTIN: 27AABCM1234F1Z5 → 27AABCM1234F2Z4`; changing an item's
    price shows `Unit price: 1250.00 → 1400.00`; changing its income
    account shows names; saving settings with a new invoice prefix shows
    `Invoice prefix: INV → SI`.
  - Verify: `bun run check-types`, `bunx oxlint`, `bun run test`; each change in the running app at 1440
    and 390 px, light and dark.
  - Depends on: Slice 1.
  - Owns/Touches: `packages/api/src/routers/party.ts`,
    `packages/api/src/routers/item.ts`,
    `packages/api/src/routers/settings.ts`,
    `packages/api/src/routers/payment-method.ts`,
    `packages/api/src/routers/account.ts` (`setActive` only),
    `packages/db/src/schema/audit.ts` (new `AuditAction` members),
    `packages/api/src/lib/document-labels.ts` (labels in
    `AUDIT_ACTION_LABELS`),
    `docs/architecture.md`.
  - Interfaces: consumes `auditChanges` and `AuditValue` from Slice 1.

## Out of Scope

- Moving audit writes into domain transactions. Owner decision: fire-and-forget
  until a customer asks.
- Edit-in-place for posted documents (Zoho style). Amend stays the correction
  path.
- Per-row audit for parties, accounts and items created by a workbook import.
  `import.commit` stays one row.
- Draft edits. A draft is not in the books until posted.
- Renaming "Amend" to "Edit".

## Explicitly Deferred

- Retention and backup duties: already a go-live gate in
  [Operations](../operations.md) (item 7 and Backups and restore).
- A legal review of the MCA wording. A CA confirms before the product claims
  compliance.

## Open Questions

None.
