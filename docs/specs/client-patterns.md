# Spec: Client patterns

Status: slices 1–2 implemented, slice 3 partly, slice 4 implemented, and slice
5 partly implemented. Authority: the founder's direction: a command palette and
conventional fast forms, no shortcut grammar before measurement, Midday's
components on Base UI, cmdk and TanStack, records in Sheets or, with a line
grid, pages, and no side panes.

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

1. **State** follows [Development](../development.md#react-and-forms): no browser
   storage, draft store or zustand.
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
   place. Posting disables the action and fields. Posted shows the number,
   "Post and next", and Print when a print artifact exists. Rejected keeps the values and shows the reason.
   No number shows before the server returns it. Nothing is optimistic: no
   inserted row, balance or outstanding. Invalidate only after success.
5. **Keyboard.** Enter moves to the next field (a Link Field first commits its
   match), except in a textarea or during IME composition. Mod+Enter posts. Esc
   closes the innermost popup, then the panel, then the overlay, one per press.
   Tab commits a highlighted match; Create needs Enter or a click.
6. **Two bindings**: Mod+K for the palette, and Mod+Enter per form. No
   registry, customizer or F-keys until H4 fails.
7. **Palette**: a cmdk `Command` (`shouldFilter={false}`) in the Base UI
   `Dialog`, opened by Mod+K or the sidebar trigger. Groups: route actions,
   navigation, Organization switch, cached Parties, and Receipts from
   `receipt.list({ q })` debounced 200 ms. `rankCommands` ranks groups by best
   match and caps Parties and Receipts at eight rows. Cancel opens the reason
   dialog. Query keys carry `orgSlug`.
8. **Overlays by URL.** List routes take `create` only for Sheet-hosted forms,
   and record Sheets take `edit`. For record Sheets, the list is a layout route
   with an `Outlet`, and the record is its child (`receipts/$receiptId.tsx`).
   There is no index route, because it would unmount the list. Closing clears
   the param and refocuses the row. Parties open a quick look (`?party=`), and
   `parties_.$partyId` owns editing. Its Transactions tab lists every Invoice,
   Bill, Note, Receipt and Payment naming the party (`party.transactions`, one
   keyset page of 25 at a time, only the types the member may read), as Zoho's
   contact page does. Journals link to `/journals/new`, and a
   journal record is a page at `/journals/$journalId`. Invoices link to
   `/invoices/new`, and a draft is edited at `/invoices/$invoiceId/edit`; the
   Invoice record stays a Sheet.
9. **Link Field**: a `Combobox` over the cached master, with rows from
   `linkRows` (prefix, then substring, on label and code), at most eight
   (`LINK_ROW_LIMIT`); typing narrows to the rest. Past a party master's bound,
   the typed text goes to `party.list({ q })`, debounced 200 ms. "Create
   <text>" comes last, hides on an exact match, and needs a complete list and
   the create grant. Create stacks the master's own form and returns the saved
   row. A document's Party field lists the parties holding its role first and
   hides none; a party it creates starts with that role.
10. **Lists** use `DataTable`. ↑ and ↓ move row focus and Enter opens the
    record; inside a Sheet, ↑ and ↓ step between rows. A page is 25 rows
    (`pageLimit`). Parties sort and filter in memory and mount 25 rows at a
    time; past the master's bound, the search runs on the server. Receipts,
    files, the audit log and Members use `useInfiniteQuery` on a keyset cursor
    with server filters; Members keeps its search `q` in the URL, and its
    pending invitations come with the first page. Only the `LoadMore` button
    grows a list; nothing loads on scroll. No virtualization until 5,000 rows break 200 ms.
    The open-item and credit pickers (`party.openItems`, `party.openCredits`)
    follow the same rule: 25 rows oldest first, then `LoadMore`, so no fixed
    count hides a document. Apply credit is a compact Dialog over the record
    Sheet: a credit combobox searched by number on the server, with a Load
    more option last; an amount defaulting to the smaller of the credit's
    unapplied amount and the claim's outstanding; and the outstanding after
    the apply. The allocation grid has no search, because a narrowed grid
    would hide amounts already typed against other rows.
11. **Document form.** Slice 4 extracts `DocumentForm`, `PostBar` and
    `LineGrid` from the Receipt form. Post-and-next keeps the date, and on a
    Receipt also the method, and focuses the first Link Field. Tab moves
    between fields natively; plain Enter never submits, Mod+Enter posts.
    `DocumentForm`, `PostBar` and `PostedView` use one layout in a Sheet or on
    a page.

## Midday adaptation

Midday commit `5158731` (AGPL-3.0) supplied the search modal, the combobox and
command primitives, the tables, column menu, filters and date presets, and the
detail views. Each file keeps its header and is listed in
`THIRD_PARTY_NOTICES.md`. A commercial licence from Midday Labs comes before
the first external release. Base UI, oRPC and router state replace Radix, tRPC,
nuqs and zustand. Framer-motion, react-virtual, dnd-kit and optimistic
financial rollback are not adopted.

## Slices

1. **Receipt entry.** Implemented: list shell, create Sheet, Receipt form,
   Party Link Field with inline create, income account and "Advance for"
   fields. Open: H4 set 1.
2. **Palette.** Implemented, with `tests/unit/palette.test.ts`.
3. **Lists and Sheets.** Implemented: Parties and Receipts on `DataTable`, the
   Party quick look and page (Overview, Receipts, Ledger), Party edit, and
   keyboard row focus. Open: the receipts list on `db:seed:volume` data, and an
   empty-query Link Field at 5,000 Parties under 200 ms.
4. **Invoice form.** Implemented. Open: H4 set 2.
   - Acceptance: the Receipt and Invoice forms both use the extracted
     `DocumentForm`, `PostBar` and `LineGrid`. Item is a Link Field with inline
     create. Place of supply defaults from the Party, stays editable and is
     passed to `computeTax`. Due date defaults to the document date, is
     editable before post and never precedes it. Lines are added with the Add
     buttons; Tab moves through fields natively. Totals and tax come only from `computeTax`, never a
     second client formula. Save draft and post send the loaded
     `draft: { id, version }` once a draft exists and omit it on a fresh form;
     a stale version shows the refresh conflict; a draft reopened from the list
     restores every field and line. A Receipt with `against`
     lists the Party's open Invoices with outstanding, allocates by amount with
     Enter, refuses more than outstanding on the field, and shows the
     remainder as advance before post. The Invoice record Sheet applies an open
     advance through `allocation.apply` and reverses it there. The list shows
     due date, total and settlement status with overdue (core call 18); filters
     include settlement status and overdue. The record Sheet shows total,
     outstanding, lines, tax split and each allocation. It offers Cancel only
     once every allocation is reversed (core call 17); reversing one
     allocation keeps a shared Receipt and its other allocation.
   - Depends on: slices 1–2 and accounting-core slice 4.
   - Owns: `routes/$orgSlug/invoices/`, `routes/$orgSlug/invoices_.new.tsx`,
     `routes/$orgSlug/invoices_.$invoiceId.edit.tsx`,
     `components/invoice-form.tsx`, `components/invoice-columns.tsx`,
     `components/invoice-summary.tsx`, `components/document-form.tsx`,
     `components/apply-credit-dialog.tsx`, the `DocumentForm` adoption in
     `receipt-form.tsx`, and `lib/domain-invalidation.ts`.
   - Interfaces: `DocumentForm`, `PostBar`, `PostedView` and `LineGrid` own the
     two proven shared seams. Every record Sheet lists allocations through
     `AllocationsSection` (the other document linked by type, Reverse while
     active); the Receipt and Payment forms allocate through
     `AllocationTable` and its pure `checkAllocations`; `PaymentMethodField`
     picks the method in the Invoice, Receipt and Payment forms;
     `DocumentTotals` shows an Invoice's or Bill's totals and `ClaimStatus`
     its settlement. Each write invalidates the set for what it moved:
     `invalidateInvoiceDrafts` (draft save or discard),
     `invalidateSettlementState` (invoice post or cancel, allocation apply or
     reverse) and `invalidateCashState` (receipt post or cancel); an uncertain
     result uses the same set as the success path, through `handleWriteError`.
     `/invoices/new` starts a new invoice and `/invoices/$invoiceId/edit` edits
     a draft, both on the page surface.
   - Legacy reference (a716b6c). Read it; do not copy it.
     - Allocation remainder: a live "Fill ₹x" or "Over by ₹x" control
       (`a716b6c:apps/web/src/components/payment-lines.tsx:77-108`). Port it
       onto bigint `formatMoney`.
     - List totals: `count(*) over()` and `sum(sum(x)) over()` beside a
       `limit + 1` page, in one query
       (`a716b6c:packages/api/src/routers/billing-worklist.ts:59-112`). The
       window reads every match before `LIMIT`; measure at pilot volume.
5. **Remaining forms.** Payment, Bill and note forms are implemented; import
   remains open.
   - Acceptance: Journal, Opening Balance and lock/Lock Exception forms are
     implemented. `components/entry-lines.tsx` is shared by the Journal and
     Opening Balance forms. The routes are
     `routes/$orgSlug/settings/{opening-balance,locks}.tsx`,
     `routes/$orgSlug/journals.tsx`,
     `routes/$orgSlug/journals_.new.tsx` and
     `routes/$orgSlug/journals_.$journalId.tsx`. The form components are
     `components/{opening-balance-form,lock-dialog,lock-exception-dialog}.tsx`.
     An exception expiry is typed as wall-clock time in the Organization zone
     and converted with `orgLocalToInstant`; the server judges "in the future".
     Conversion uses `@date-fns/tz` only for offsets, retaining round-trip gap
     rejection and separate date-only arithmetic ([decision](../research/midday-timezones-2026-09-22.md)).
     Payment (`direct`, `advance`, `against` open Bills with allocations, a TDS
     section Link Field), Bill (lines with `itcEligible`, an optional TDS
     section, due date, and the Invoice settlement display and cancellation
     flow), and Credit and Debit Notes against a source Document are
     implemented. Import remains open: template download, upload, row errors
     listed, nothing written on any error.
     Payment offers Against only to roles that can read Bills and Notes; its
     Credit Note refund picker filters on the server before the page.
     Sheet-hosted document forms use `DocumentForm` with the four posting
     states and a list route with the same shell, `DataTable` and record Sheet.
     A document with a line grid uses the page surface. Settings forms use the
     settings form pattern. Forms are reachable from the palette.
   - Depends on: slice 4 and accounting-core slices 3 and 5; import needs 7.
   - Owns: `routes/$orgSlug/{payments,bills,notes}/`,
     `routes/$orgSlug/bills_.new.tsx`,
     `routes/$orgSlug/bills_.$billId.edit.tsx`,
     `routes/$orgSlug/notes_.new.tsx`,
     `routes/$orgSlug/journals.tsx`, `routes/$orgSlug/journals_.new.tsx`,
     `routes/$orgSlug/journals_.$journalId.tsx`,
     `routes/$orgSlug/settings/{opening-balance,locks}.tsx`,
     `routes/$orgSlug/settings/import.tsx`, `components/entry-lines.tsx`,
     `components/{opening-balance-form,lock-dialog,lock-exception-dialog}.tsx`,
     `components/{payment-form,bill-form,note-form}.tsx`,
     `components/{payment-columns,bill-columns,note-columns}.tsx`, and
     `lib/domain-invalidation.ts`.
   - Interfaces: `invalidateBillDrafts` covers Bill draft saves and discards;
     `invalidateSettlementState` covers Invoice, Bill and note posting and
     cancellation and allocation changes; `invalidateCashState` covers
     Receipt and Payment posting and cancellation, plus Invoice counter sales.
     The forms consume the slice 4 parts unchanged.

Check each slice in the running app on desktop and mobile, in both themes. Pure
helpers get unit tests; there is no UI test framework.

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
