# Architecture

Bun and Turborepo: TanStack Start (`apps/web`), Hono and oRPC (`apps/server`,
`packages/api`), Drizzle and PostgreSQL (`packages/db`), Better Auth
(`packages/auth`), private S3 storage (`packages/storage`) and Base UI
components (`packages/ui`). HTTP, web SSR, the receipt PDF route and tests call
one `appRouter` with the same request context and guard. RPC bodies stop at 1
MiB. Development reference pages never mount in production.

## Tenancy and authorization

```text
/:orgSlug/... → input.orgSlug → orgProcedure(permission, input)
  → session + indexed membership + union-role grant
  → context.scope { orgId, userId } → WHERE org_id = scope.orgId
```

The slug is untrusted input. It is never session state and never falls back.

- Slugs are immutable, URL-safe, at least four characters, and outside the
  reserved root names.
- A missing claim fails validation, no session is `UNAUTHORIZED`, and no
  membership or grant is `FORBIDDEN`. A foreign slug looks like an unknown one.
- Membership is memoized for one request, so revocation applies on the next.
  Each procedure checks and audits its own denial.
- SQL uses only `context.scope.orgId`. `userId` is attribution.
- Every lookup, write and referenced id carries the tenant predicate. A foreign
  id is `NOT_FOUND`. A conditional state write may return one `CONFLICT` for a
  missing and a moved row. Prices and taxes come from server rows.
- There is no RLS. Predicates and the tenancy tests enforce isolation. RLS may
  later add depth; it never replaces the guard.

Roles live only in `packages/auth/src/access.ts`. Better Auth stores them
comma-joined. `parseRoles` and `authorize` read a union and throw on an unknown
role, Better Auth's `member` and `admin` included. The roles are `owner`,
`accountant`, `ca` and `operator`
([call 10](./specs/accounting-core.md#architecture-calls)). Only `owner`
manages members, invitations and settings, and uploads or deletes files. Client
checks only hide controls.

Better Auth's organization endpoints under `/api/auth/*` enforce their own
permissions, may read active-organization state, and skip our membership audit.
Product flows use the guarded `member.*` procedures; tests pin this until that
surface closes.

No email is sent. An owner hands an invitation id (UUIDv7) to one person. The
`invitation-claim` plugin lets `/sign-up/email` create an account only with a
live invitation for that email, and refuses every other path. Operator scripts
insert users directly. Accounts stay `emailVerified: false`. `member.list` shows
links only to holders of `invitation: ["create"]` and hides expired rows. The
public join lookup returns the invited email, the organization, and whether an
account exists. Better Auth checks the session email when it accepts.

A new org-scoped domain follows the
[`org-scoped-feature`](../.agents/skills/org-scoped-feature/SKILL.md) skill.

## Web data flow

- Org pages server-render. The `/$orgSlug` loader reads `member.me` (identity,
  roles, organizations, time zone) through the request-local client. Base UI
  popups stay behind `ClientOnly`.
- TanStack Query is the only cache (`lib/orpc.ts`, `query-client.ts`,
  `operational-query.ts`). Loaders prime it, components subscribe with the same
  `queryOptions`, and loaders never pass data down as props. Membership comes
  from `useMembership` through `membershipOptions`, stale after five minutes;
  member and settings edits invalidate it.
- The browser client batches calls made in the same tick into one `/rpc`
  request (`BatchLinkPlugin`, `BatchHandlerPlugin`). The calls share one
  context, so the session and membership resolve once per batch.
- A gated route checks in its loader every grant it needs to submit
  (`requireOrgPermission`), and redirects. `useCan` hides actions on readable
  pages.
- `/` and `/login` call `redirectSignedInHome` in `beforeLoad`. A member goes to
  the first organization by name; anyone else goes to `/join`. A validated
  `redirect` on `/login` wins. The organization home is `/$orgSlug/receipts`.
- A tabbed record keeps shared chrome in its layout route. Declare context
  shared by sibling routes outside the route tree: TanStack Start splits route
  files into chunks with separate context objects.
- Every query key includes `orgSlug`. Growing lists use full keysets and select
  `limit + 1` base rows through a tenant-leading index before joins. Never use
  `OFFSET`.
- Live lists poll every 10 s (stale after 5 s), refetch only page one, and pause
  in background tabs. There is no WebSocket or SSE.

Query, form and invalidation rules are in
[Development](./development.md#react-and-forms).

## Data and migrations

- Every Organization-owned row has `orgId NOT NULL`. Ids are UUIDv7 text unless
  the record needs another key. Do not infer field contracts from convention.
- PostgreSQL enforces structure: tenant-safe composite foreign keys, unique and
  partial unique indexes, and CHECKs for data-integrity invariants only
  (non-negative money, one-sided journal lines, closed state and type enums
  that code owns, date ranges, the advance-supply presence rule).
- Volatile and regulatory rules live in the application, in zod
  (`packages/api/src/lib/schemas.ts` and router inputs): supply classes, legal
  types, state codes, Party roles, the TDS rate range, advance-supply values and
  the document number format. A change to them needs no migration. Party GSTIN
  uniqueness per Organization is an application check (`PARTY_GSTIN_TAKEN`),
  not an index.
- Indexes lead with `org_id` and match the real filter, order and keyset.
- Write with scoped `UPDATE ... RETURNING`. Edits compare-and-swap on the loaded
  `updatedAt` (`timestamptz(3)`). Zero rows is a stale-record `CONFLICT`, with
  no retry.
- Member and short master names are stored lowercase. Legal names, addresses,
  notes, references and identifiers keep their case.
- One `organization_settings` row per Organization holds identity, address,
  financial year, time zone, prefixes and settings. Readers query it directly;
  there is no settings cache.
- Migrations run before startup under an advisory lock and must suit a draining
  old instance ([rules](./development.md#code-rules)).
- Tests use real PostgreSQL and wipe only a database whose name ends in `_test`.

## Audit and files

`audit()` is fire-and-forget. It records role denials and sensitive successes
(membership and settings changes, file deletion, posts, cancellations, lock
changes and exceptions), never
reads or ordinary writes. A foreign claim cannot write another tenant's log.
URLs, tokens and secrets never enter metadata; an unverified file key is stored
as a digest. Journal entries differ: they commit with their document, because ledger
drift must fail the transaction and an audit outage must not.

Objects are private. The browser moves bytes with 15-minute presigned URLs; keys
are `<orgId>/<uuid>/<sanitized-name>`. An upload stays `pending`, and invisible,
until a scoped update marks it `ready`. Deletion removes the row, then the
object best-effort, so a failure leaves an orphan, never a dangling row.

## Ledger

Evidence, not decisions: `docs/research/ledger-architecture.md` (13 products and
ledger engines, with code paths and URLs) and
`docs/research/accounting-contract-decisions-2026-09-10.md` (ERPNext, Frappe
Books and Odoo posting code at pinned commits), in Git at `a716b6c`. Where they
differ from this page (materialized balances, a posting-rule table, database
triggers), this page wins.

### Documents first, append-only

Documents are the only write model. Posting writes the document, the journal
entry and lines, and the party ledger lines in one transaction. Posted rows
change only through post and reverse; a correction is a reversing entry.
`recordEntry` refuses an unbalanced entry (`assertBalanced`), and no code
updates or deletes a journal line. Add a database guard only when a second
writer appears. ERPNext, Odoo, Xero and Square Books share this shape. Two other
shapes lost. A ledger-first voucher system (TallyPrime) makes the user choose
accounts on every entry and permits edits in place. An event-sourced ledger
with projections suits offline sync, but its event schemas are versioned
forever, a projection change is a replay, and a late projection shows a wrong
balance. Documents first won on entry speed, migrations, AI read models and
cost. Event-sourced replay is given up; a hash chain can come later without a
model change. Offline sync needs its own replay contract, idempotency keys and
per-site number series ([deferred](./specs/accounting-core.md#deferred)). A
feature that wants to edit a posted row adds a document type or a reversal.

### Posting mechanics in code, accounts and rates in data

Each document type has one pure posting function in `core/posting.ts` that
branches on `settlementKind` and `exposureSide`; a Journal's legs are its own
lines. Accounts come from data: the method's account, the line Account, and
`Account.systemKey`, seeded per legal type and unique per Organization. Tax
Rates are immutable dated rows, and pure `computeTax` follows
[call 5](./specs/accounting-core.md#architecture-calls). No account id, name or
rate is in code. A
posting-rule table keyed by document type, line kind, tax class and legal type
was rejected. An advance Receipt has no line to key on, its debit comes from
the Payment Method, and a Payment that refunds a Credit Note hits receivables
although money goes out; a key that covers these becomes a rules language.
ERPNext, Frappe Books and Odoo build these legs in code. A new accounting event
is reviewed code plus a `systemKey` seed, with a unit test per branch.

### Post and cancel

- `postDocument` takes the header, a lines array and the draft token that
  [slice 4a](./specs/accounting-core.md#slices) defines. `writeDraft` inserts
  the draft, or replaces it and its lines while the token still matches; a
  stale token is `CONFLICT`. Receipt and Payment pass one `accountLine`. An
  `against` Receipt inserts its allocations before `recordEntry`; the entry
  credits receivables for the allocated amount and customer advances for any
  remainder. `postDocument` also writes the party ledger line and any TDS
  deduction. `postNumbered` runs last on every path, so the number-series lock
  spans only numbering and commit, and a rollback takes the number with it: no
  gaps.
- `recordEntry` (General Accounting) is Billing's only call into General
  Accounting. A post resolves system accounts and runs the posting function. A
  reverse swaps the stored post lines and never reruns the function, rates or
  mappings.
- `reverseDocument` is one transaction. A conditional update first moves the
  posted document to `cancelled` (anything else is `CONFLICT`). Allocations then
  follow [call 17](./specs/accounting-core.md#architecture-calls). Last, the
  party ledger lines and entry are reversed. Ordinary documents reverse on
  today's business date in the Organization time zone; Opening Balance reverses
  on its original cutover so a replacement corrects historical balances.
  The reversal date must pass the period lock. A refusal rolls back the state
  change; `cancelledAt` remains the actual cancellation instant.
- `organization_settings.lockedThrough` and `taxLockedThrough` own the current
  lock dates. Every ledger writer reads settings `FOR SHARE` (or stronger) inside its
  transaction before document locks, using that same row for tax, numbering
  and dates. `assertPeriodOpen` (`core/locks.ts`) checks the held dates and reads
  `lock_exceptions` only when the general lock needs a bypass.
  `lock.set` reads settings `FOR UPDATE`, compares `expectedLockedThrough` with
  the current date, then updates it and appends history atomically. Missing
  settings is an integrity failure; a stale date is `CONFLICT`, so the client
  refreshes and closes the stale form. Lock changes and revocation wait for
  in-flight postings before changing the held settings or exception. Posting never
  scans lock history. Expiry uses `statement_timestamp()`. Spec
  [call 7](./specs/accounting-core.md#architecture-calls).
- Receipt and Payment validate posting-critical masters after locking settings,
  holding the resolved rows `FOR SHARE` until commit: the active Party supplies
  the snapshot and exposure; the direct income/expense Account supplies posting
  eligibility and supply class; the TDS Section supplies effective dates and rate;
  the Payment Method supplies its active state and account mapping. Updates or
  deactivation wait until the posting commits. The stored posting and snapshot
  retain those validated values. Locks belong to these transaction paths, not
  to all master reads; Item and Invoice draft validation use unlocked reads.
- One `post` entry and at most one `reverse` entry exist per document:
  `journal_entries` has a unique index on
  `(orgId, documentType, documentId, kind)` and a partial unique index on
  `reversesEntryId`.
- A number is prefix, short financial year, `/` and sequence: `RCT26-27/1`. A
  prefix has 1–4 letters, digits, `-` or `/`, stored in upper case because
  GSTR-1 and the IRP compare numbers without case. The series key is (org,
  type, financial year, prefix). `postNumbered` refuses a number longer than 16
  characters (GST Rules 46 and 50) with `BAD_REQUEST` `NUMBER_SERIES_FULL`; the
  owner then changes the prefix, which starts a new consecutive series.
- There is no balances table: balances are sums of journal lines, as in ERPNext
  and Odoo. A period-close snapshot is
  [deferred](./specs/accounting-core.md#deferred).

### Allocations

The allocation rows, their locks and their effect on cancellation are
[call 17](./specs/accounting-core.md#architecture-calls).

### Items and tax

Items and Tax Rates are defined in the
[canonical language](./specs/accounting-core.md#canonical-language); tax
follows [call 5](./specs/accounting-core.md#architecture-calls).

### Money accounts

The chart has a Cash group (1000, `systemKey` `cash`) and a Bank Accounts group
(1100, `bank`). Money sits in their leaves: 1001 Cash in Hand, 1101 Bank
Account, and cash or bank leaves that `account.create` adds.
`account.moneyBalances` returns each leaf with its group and balance on Banking.
The complete chart supplies parent groups for account creation. A Payment Method names one active money
leaf, so the method decides where money lands, as in ERPNext; there is no
per-receipt deposit account. `paymentMethod.setActive` archives a method, and
old documents keep it. New Organizations get Cash → Cash in Hand, and UPI, Bank
transfer and Card → Bank Account. Direct receipts and payments cannot name a
money account, a group or a system account (`postableAccount`).

Bank Charges (6800) is a plain expense. A card MDR or bank fee is a direct
Payment to it, from the bank statement. Record actual fees; never model per-bank
fee rules or settlement days.

Banking lists money accounts, balances and methods to anyone with
`account` `read`, `paymentMethod` `read` and `report` `readFinancial`, the CA
included. Adding an account needs `account` `create` and opens the Chart of
accounts Add account Sheet; adding or archiving a method needs
`paymentMethod` `create` and `update` and opens a right Sheet
([Design](./design.md#10-task-overlays)).
