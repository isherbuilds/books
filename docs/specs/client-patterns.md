# Spec: Client patterns

Command palette and conventional fast forms; no shortcut grammar before the
[speed gate](#speed-gate-h4) fails. UI surfaces follow
[Design](../design.md#10-task-overlays). Open checks are in [Slices](#slices).

## Speed gate (H4)

One operator enters the same ten transactions by hand in TallyPrime and in
Accly Books, with a stopwatch and a keystroke logger, in counterbalanced order
after a warm-up. Both start ready: the Books receipts list with Parties loaded,
and TallyPrime at Gateway with the company open. Set 1 is ten `advance`
bank-transfer receipts with a reference (in Tally, F6 with reference type
Advance). Set 2 is ten five-line Invoices against a measured Tally baseline.
Done means posted, with the number visible. Pass within 10 percent. A result
more than 25 percent slower kills the approach, and only that reopens
shortcuts. Each interaction (select Party, add line, post) paints within
200 ms; INP p75 comes from the pilot. Record the figures here.

## Calls

1. **State** follows [Development](../development.md#react-and-forms): no draft
   store or zustand.
2. **Cached masters.** `party.list`, `account.list`, `paymentMethod.list` and
   `item.list` return lists up to 5,000 rows (`MASTER_LIST_LIMIT`), stale
   after five minutes. `party.list` carries only what lists show (name, roles,
   GSTIN, active); the quick look and the party page read `party.get`. A save
   writes the returned row into the cache, then invalidates. Link Fields
   filter in memory. `party.list` returns `{ rows, hasMore }` and takes an
   optional `q` on name or GSTIN: past the bound, the Party Link Field, the
   palette and the parties page search the server, so no party is
   unreachable. The other masters stay complete or refused with a capacity
   error, because their fields resolve a saved id from the cached list. A list
   that is over the bound, loading or failed, or a search still catching up
   with the text, never offers Create or "No matches".
3. **Plain mutations.** After a lost response, the operator checks the list
   before re-entry.
4. **Posting state** (`draft`, `posting`, `posted`, `rejected`) renders in
   place. Posting disables the action and fields. Posted is a toast with the
   number, plus Open for a record page or Print when a print artifact exists; a
   new document's form then clears for the next entry, and a draft or a
   receipt against one Invoice goes on to its record or closes. Rejected keeps
   the values and shows the reason.
   No number shows before the server returns it. Nothing is optimistic: no
   inserted row, balance or outstanding. Success and uncertain results invalidate
   through the [query contract](#queries-and-invalidation).
   Invoice quoting and payment lines follow the
   [Invoice editor contract](./invoice-editor.md#contract).
5. **Keyboard.** Enter moves to the next field (a Link Field first commits its
   match), except in a textarea or during IME composition. Mod+Enter posts;
   its footer hint is shown only on non-touch desktop widths. Esc closes the
   innermost popup, then the panel, then the overlay, one per press.
   Tab commits a highlighted match only after typing; Create needs Enter or a click.
6. **Two bindings**: Mod+K for the palette, and Mod+Enter per form. No
   registry, customizer or F-keys until H4 fails.
7. **Palette**: a cmdk `Command` (`shouldFilter={false}`) in the Base UI
   `Dialog`, opened by Mod+K or the sidebar trigger. Groups: route actions,
   navigation, Organization switch, Parties and Documents. The palette searches
   Invoices, Receipts, Bills, Payments and Notes after a 200 ms debounce.
   `rankCommands` ranks groups by best match and caps Parties and Documents
   at eight rows each. Cancel opens the reason dialog.
8. **Overlays by URL.** List routes take `create` only for Sheet-hosted forms,
   and record Sheets take `edit`. For record Sheets, the list is a layout route
   with an `Outlet`, and the record is its child (`receipts/$receiptId.tsx`).
   There is no index route, because it would unmount the list. Closing clears
   the param; focus follows [Design](../design.md#8-layout-primitives).
   Parties open a quick look (`?party=`), and
   `parties_.$partyId` owns editing. Its Transactions tab lists every Invoice,
   Bill, Note, Receipt and Payment naming the party (`party.transactions`, one
   keyset page of 25 at a time, only the types the member may read), as Zoho's
   contact page does. A Journal names parties on its lines, not its header, so
   it appears on the party's Statement and open items, not on Transactions. Journals link to `/journals/new`, and a
   journal record is a page at `/journals/$journalId`. Invoices link to
   `/invoices/new`, and a draft is edited at `/invoices/$invoiceId/edit`; the
   Invoice record stays a Sheet.
9. **Link Field**: a `Combobox` over the cached master, with rows from
   `linkRows` (prefix, then substring, on label and code). It shows at most six
   rows on open or while the person types. Past a party master's bound,
   the typed text goes to `party.list({ q })`, debounced 200 ms. "Create
   <text>" comes last, hides on an exact match, and needs a complete list and
   the create grant. Create stacks the master's own form and returns the saved
   row. A document's Party field lists the parties holding its role first and
   hides none; a party it creates starts with that role.
10. **Lists** follow [Design](../design.md#8-layout-primitives). ↑ and ↓ move
    row focus and Enter opens the record; inside a Sheet, ↑ and ↓ step between
    rows. A page is 25 rows (`pageLimit`). Parties sort and filter in memory and
    mount 25 rows at a time; past the master's bound, search runs on the server.
    Receipts, files, audit and Members use `useInfiniteQuery` with server
    filters; Members keeps `q` in the URL and returns pending invitations with
    the first page. The allocation grid alone grows by its Load more button.
    A dated page opened without dates moves to its default period in the URL
    (`requirePeriod`): this month for Invoices, Bills, Receipts and Payments;
    this financial year for Notes, Journals and a party's Transactions and
    Ledger. All time is an explicit `?all=true`. Search text or a Party
    filter opened without dates skips the default period and shows all history;
    existing date filters stay active. A register row
    carries only what its columns, card, palette entry and cursor read;
    everything else is one click away in the record Sheet. Search still
    matches the reference and narration on the server.
    Each Receipts, Payments, Invoices, Bills and Notes register loads a separate
    tenant-scoped aggregate over the full current filter, not the loaded page:
    document count and amount, plus unapplied on Notes. The Receipts aggregate
    also lists count and amount by Payment Method. Choose a single Date in the
    Receipts filter to use that breakdown as day-close totals. A status-filtered
    register totals exactly its listed states; absent a state filter, cancelled
    documents remain included and the amount is gross, not a ledger net.
    Aggregates have no cursor, share the list predicate, and refetch through
    the existing domain invalidations.
    Open-item and credit picker paging follows
    [Accounting core](./accounting-core.md#slices). Apply credit is a compact
    Dialog over the record
    Sheet: a credit combobox searched by number on the server, with a Load
    more option last; an amount defaulting to the smaller of the credit's
    unapplied amount and the claim's outstanding; and the outstanding after
    the apply. The allocation grid has no search, because a narrowed grid
    would hide amounts already typed against other rows.
11. **Document form.** `DocumentForm`, `PostBar` and `LineGrid` are shared;
    layout follows [Design](../design.md#10-task-overlays). Reset after post
    keeps the date, and on a Receipt also the method, then focuses the first
    Link Field. Tab moves natively; plain Enter never submits.
12. **Invoice fields and records.** Item uses a Link Field with inline create.
    Place of supply defaults from the Party and stays editable; due date defaults
    from document date and stays editable before post. Draft tokens, allocation
    limits, settlement status and cancellation follow
    [Accounting core](./accounting-core.md#slices). A reopened draft restores
    every field and line. Invoice lists show due date, total, settlement and
    overdue; records show total, outstanding, lines, tax split and allocations.
13. **Shared settlement parts.** `AllocationsSection` links the other document
    by type and offers Reverse while active. Receipt, Payment and Journal forms
    use `AllocationTable` and pure `checkAllocations`. The table takes the form
    path, a `remainingFor` callback and totals as children, never a mode prop:
    each caller supplies its capacity rule and totals. `PaymentMethodField`
    picks the method; `DocumentTotals` renders Invoice or Bill totals and
    `ClaimStatus` renders settlement.
14. **Remaining forms.** Journal and Opening Balance share `entry-lines.tsx`.
    Lock exception expiry uses `orgLocalToInstant` for wall-clock time in the
    Organization zone, with `@date-fns/tz` only for offsets; round-trip gap
    rejection and separate date-only arithmetic follow
    [Accounting core](./accounting-core.md#journal-opening-balance-and-locks-slice-5).
    Payment offers Against only to roles that can read Bills and Notes; its
    Credit Note refund picker filters on the server before the page. Payment,
    Bill and Note fields and Settings > Import follow
    [Accounting core](./accounting-core.md#slices). Forms are reachable from the
    palette; settings forms use the settings form pattern.

## Queries and invalidation

- TanStack Query is the only cache (`lib/orpc.ts`, `query-client.ts`,
  `operational-query.ts`). Loaders prime it and components subscribe with the
  same `queryOptions`, never loader data props. Query keys include `orgSlug`.
- Report loaders start non-awaited prefetches; bodies read with suspense inside
  local boundaries, so headers and controls appear immediately and streamed
  SSR results hydrate without a loading/data mismatch.
- Membership comes from `useMembership` through `membershipOptions`, stale
  after five minutes; member and settings edits invalidate it.
- A tabbed record keeps shared chrome in its layout route. Context shared by
  sibling routes lives outside the route tree: TanStack Start splits route files
  into chunks with separate context objects.
- Required queries use `loadRouteQuery` and `useSuspenseQuery`, failing to the
  route boundary. Optional queries prefetch with `.catch(() => {})`, read with
  `useQuery` and show `ErrorNote` in place. Never both for one procedure.
- Live lists add `OPERATIONAL_INFINITE_REFETCH`: poll every 10 s, stale after
  5 s, refetch on focus only while page one is the only loaded page, and pause
  polling in background tabs. Page two stops polling and focus refetching.
  There is no WebSocket or SSE.
- Time zone and today's business date come from `useOrgDateTime`;
  `settings.get` needs `settings:read`.
- Failed reads render `ErrorNote`; a failed list refresh keeps rows (`ListState`).
  Failed writes use `handleWriteError`: CONFLICT or a lost response dismisses
  and refetches; other refusals reach their field or toast
  `errorMessage(error, "Could not …")`, never raw `error.message`.
- Writes use `lib/domain-invalidation.ts`: `invalidateInvoiceDrafts` and
  `invalidateBillDrafts` cover draft save/discard; `invalidateSettlementState`
  covers Invoice, Bill and Note post/cancel and allocation apply/reverse;
  `invalidateCashState` covers Receipt and Payment post/cancel and counter sales.
  Uncertain results use the success path's set through `handleWriteError`.
- Remote type-ahead debounces before the query key. Filter locally only a
  complete, bounded list.

## Midday adaptation

Midday commit `5158731` (AGPL-3.0) supplied the search modal, the combobox and
command primitives, the tables, column menu, filters and date presets, and the
detail views. Each file keeps its header and is listed in
`THIRD_PARTY_NOTICES.md`. A commercial licence from Midday Labs comes before
the first external release. Base UI, oRPC and router state replace Radix, tRPC,
nuqs and zustand. Framer-motion, dnd-kit and optimistic financial rollback
are not adopted.

## Slices

- Receipt entry: H4 set 1 remains open.
- Lists and Sheets: row-focus and receipts-list checks on `db:seed:volume`,
  and an empty-query Link Field at 5,000 Parties under 200 ms remain open.
- Invoice form: H4 set 2 remains open.
- Runtime acceptance follows [Development](../development.md#commands) and the
  [work registry](../README.md#work-lifecycle); pure helpers use unit tests.
  There is no UI test framework.

## Deferred

- **Draft autosave.** Gate: an operator loses invoice work.
- **Remote lookup for items, accounts and payment methods above 5,000 rows.**
  Their fields resolve a saved id from the cached list, so a search would also
  need a lookup by id. Gate: an Organization needs it.
- **Global record search** (`search.records`, pg_trgm, one tenant-predicated
  branch per type). Gate: a second document list, or `receipt.list` search
  over 200 ms at pilot volume. Confirm pg_trgm on the production host first.

Out of scope: a shortcut grammar or customizer, inline cell editing, column
drag, bulk actions, offline entry, the assistant and print template editing.
