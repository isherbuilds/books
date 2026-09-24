---
name: lean-code
description: >-
  Simplify Accly Books routers and React data flow. Use for abstraction, query, or state
  changes and lean-code reviews; skip copy, styling-only, and documentation edits.
---

# Lean code

The app is pre-production. Backward compatibility, deprecated aliases, and shims do
not exist here. The bar is: the smallest code that is correct, fast, and readable by
someone who did not write it. This skill is the lens for both writing and reviewing.

Use the sections relevant to the changed behavior; backend-only work does not need
the frontend checklist, or vice versa. Verify findings against the owning code and
real callers, not grep hits alone.

## 1. What `orgProcedure` already gives you

`orgProcedure(permission, input)` in `packages/api/src/lib/procedures/factory.ts`
proves the session, resolves membership, checks the permission, and exposes
`context.scope = { userId, orgId, roles }`. Inside a handler:

- Never re-check the session, membership, or a role. If a handler branches on a
  capability, it is an input to the permission argument, not code in the body.
- Reference checks are not auth checks. Verifying that a Party, account, or Payment
  Method id belongs to `scope.orgId` is required — but do it once, in as few round
  trips as the data allows, and use the row you fetched. A foreign id returns
  `NOT_FOUND`; a Postgres FK error is not an acceptable substitute.
- The client cannot claim a fact the server can derive. A Receipt's money account
  comes from its Payment Method, so the input carries no account id for the money leg.

## 2. Backend rules

- **Parallel by default.** Independent reads go in one `Promise.all`. Reads that do
  not need the transaction's snapshot run before `db.transaction`. A transaction
  holds writes and the reads that lock rows for those writes — nothing else.
- **One insert per table per handler.** Build the rows in order, insert once. Do not
  allocate ids ahead of time to fake ordering across two inserts.
- **No second lookup to pick an error.** A conditional `UPDATE … RETURNING` that
  returns nothing means "missing or already moved". Throw one `CONFLICT`. Do not
  re-select the row to decide between `NOT_FOUND` and `CONFLICT`.
- **Return what a caller reads.** Check `apps/web/src` for every field of a
  procedure's result before shaping it. A result key nobody reads is deleted, and so
  is the code that computes it. Same for input fields nobody sends and `select()`
  columns nobody renders.
- **A helper is created at the second real caller.** An existing one-caller helper is
  inlined only if it merely forwards — wraps a single `throw` or one query behind an
  options object. Keep it if it names a concept (`postableAccount`, `claimPartyName`,
  `assertBalanced`).
- **Error reasons are read or they are gone.** `ConflictReason` holds only values a
  web file branches on. If the client's response to every CONFLICT from a screen is
  "refetch and show the message", the reasons on that path are removed.
- **Shared fragments live in one place.** Zod fragments used by two routers
  (`money`, `reason`, `indianStateCode`, `settlementPostFields`, …) are in
  `packages/api/src/lib/schemas.ts`. Do not re-declare a regex.
- **Locks are for writes that race.** `FOR UPDATE` on a row you only read to insert
  a child with a unique index is not a lock, it is a comment.
- Keep (hard rules aside): the request-local membership memo, DST-correct business-date code (any IANA zone
  is accepted; `tests/unit/business-date.test.ts` pins it).

## 3. Frontend rules

- **One `queryOptions` per fact.** Components subscribe with the same
  `queryOptions` the loader primed, per
  [Architecture: Web data flow](../../../docs/architecture.md#web-data-flow). No
  context pair to split "the data" from "the status", no re-reading the query
  cache by a hand-built key, no `useMemo` keyed on a joined string to dodge a
  re-render nobody measured.
- **One source of truth for money.** Tax and totals come from the server (slice 4
  `computeTax`). A form shows the amounts the operator typed, never a
  client-computed total beside a server one.
- **`keepPreviousData` is one line; the machinery around it is not.** Keep the
  line, gate submit on `isSuccess && !isFetching`, and delete `isPlaceholderData`
  bookkeeping, `current`/`data`/`waiting` projections, and hide-when-placeholder
  branches.
- **Copy does not change with state.** One stable empty state ("No payment methods
  yet"), one control when the operator needs an action. No paragraph that rewrites
  itself when a Party is picked.
- **Form state stays in the form.** The dirty flag is
  `useFormState({ control }).isDirty` read during render in the component that owns
  the form (`PartyForm` gates Save on it), not a DOM attribute another file
  queries. (RHF's `formState` is a proxy; a callback-only read never subscribes.) A
  wrapper that does not own the form's `control` (`PartySheet` around `PartyForm`)
  reads no form state; it reads `useIsMutating` to stay open while a save runs, so
  a refusal lands on a mounted form.
- **Composition is visible.** A route fetches once and passes data down as props. A
  file that holds route + loader + list + create/edit overlays + mutations is a god
  module: move each overlay to a sibling file with explicit props. Split only at a
  seam that has a name (`receipt-overlay.tsx`, `party-quick-look.tsx`); never split
  a cohesive 240-line component to chase a line count. Three overlays sharing 11
  identical scaffold lines earn one shell component; two do not.
- **Overlays that survive a reload live in the URL.** A Sheet that shows or edits a
  record is opened by a search param (`?party=`, `?edit=true`) via
  `validateSearch` + `navigate({ search })`, or by a child route that renders a
  record Sheet over its still-mounted list (`/receipts/$receiptId`), not
  `useState`. Back closes it; the link is shareable. Transient confirmations stay in
  state.
- **CONFLICT means stale, and it closes the overlay.** The overlay holds a snapshot
  the server will keep rejecting, so `onError` on CONFLICT invalidates, toasts the
  server message, and closes the overlay or dialog. `PartyForm` does all three for
  `STALE_RECORD`, and the Receipt cancel dialog does them for any CONFLICT; a form
  that only toasts is a dual path. Read `data.reason` only to map a refusal to a
  field (`PARTY_GSTIN_TAKEN`, `TAXABLE_DIRECT_RECEIPT`).
- **A mutation hook is written once.** The Receipt Sheet's Cancel button and its
  palette action open the same reason dialog and call one `receipt.cancel` mutation.
- Props that are always the same literal (`open={true}`), callbacks with no caller,
  re-exports with no importer, and components split solely to isolate a render are
  deleted.

## 4. Review procedure

For a router, a component, or a diff:

1. List every procedure/export and its callers (`apps/web/src`, `tests`, `scripts`).
   Zero callers → delete. One caller → inline unless it is in the exceptions above.
2. For each handler: which awaits are independent? Which reads are outside the
   transaction? Which selected columns and result keys does the client read?
3. For each `throw`: does anything read the code/reason? Is there a query whose only
   purpose is choosing the error?
4. For each component: how many subscriptions to the same query? Any context that
   exists to avoid a re-render? Any copy that branches on state?
5. Write findings as `path:lines — what — why redundant — change — risk`, and state
   the verified call-site count next to every "inline" or "delete".
6. Coverage removed: list every deleted test with a one-line justification. A test
   deleted alongside the code it proved (a lock, a race, a tenancy assertion) is a
   finding, not cleanup.

## 5. Before calling it done

Sections 2–4 are the checklist. In addition:

- [ ] Tenancy assertions in `tests/integration/tenancy.test.ts` are unchanged or stronger.
- [ ] Checks per [Development: Commands](../../../docs/development.md#commands): the smallest existing checks that cover the change; the full gates only when the task or the command policy requires them. A read-only review runs only read-only checks.
