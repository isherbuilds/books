# Spec: Invoice editor — live totals, split payment and MRP

Status: verification
Authority: the owner's requests of 2026-09-25: partial payment "like we do in
HMS"; "redesign the invoice page to accommodate item composition better";
"discount will never be item wise … mostly discount on entire bill"; and the
MRP idea for medical bills, provided general users do not see it.
Supersedes: the counter-sale contract in `accounting-core.md` slice 4b
(`settle: { paymentMethodId, reference? }` for the full total).
Depends on: `invoice-ship-to.md` (its form fields stay as built).

## Problem

The invoice page is a column of form fields, not an invoice.

- Nothing shows what the invoice comes to. A line has no amount, and tax and
  the total appear only after a draft is saved.
- Discount sits beside the header fields, so it reads like header data.
- The description takes as much width as the item.
- A counter sale must settle the full total with one method. A customer who
  pays part now, or pays part in cash and part by UPI, cannot be entered.
- A pharmacy sells below MRP and wants each line to show the price against MRP.

## Solution

The page reads like the document it produces, following Midday's editor and
HMS's settlement:

1. **Header.** On the left: Party, with its Bill-to card (address, GSTIN)
   under the picker, then the ship-to checkbox. On the right: invoice date,
   due date and place of supply.
2. **Line grid.** Item (widest), then Qty, Rate and Amount. HSN/SAC and GST %
   show read-only under the item name. The description is a smaller optional
   second line under the item.
3. **Footer.** Reference and Narration on the left. On the right, the totals
   panel: Subtotal, Discount (an input), CGST + SGST or IGST, Round-off and
   Total. Under the total, the Received payment lines and Balance due.
4. **Live totals.** The server calculates them from the same code that posts
   the invoice, so the screen never disagrees with the result.
5. **Split and partial payment.** HMS's payment lines: method, amount and
   optional reference, up to 4 lines. "Split payment" adds a line pre-filled
   with what is still owed. "Fill ₹X" completes the last line. "Over by ₹X"
   blocks posting. With no line, the invoice is a credit sale; this replaces
   the Pay later / Paid now toggle.
6. **MRP.** Optional on an Item. When the item has one, the line shows
   "MRP ₹X · N% off" under Rate, or a warning when Rate is above MRP. The PDF
   gets an MRP column only when a line has one. With no MRP, nothing changes
   anywhere, so general users do not see it.

## User stories

1. As an operator, I want each line's amount and the invoice's tax and total
   to update as I type, so that I can read the total to the customer before I
   post.
2. As an operator, I want one bill-level discount in the totals, so that the
   header holds only document facts.
3. As a cashier, I want to record part of the payment now, so that the rest
   stays outstanding on the invoice.
4. As a cashier, I want to split a payment across methods, so that cash and
   UPI land in their own accounts.
5. As a pharmacy operator, I want to see how far below MRP I am selling, and a
   warning above MRP, so that I price correctly.
6. As a user without MRP items, I want the page unchanged by MRP.

## Implementation decisions

- **Discount stays bill-level only.** No line discount will be added. The
  existing `discount` input and `splitDiscount` spreading are unchanged; the
  field moves to the totals panel with a ₹/% switch, as Zoho's. A percentage
  goes to the API as `discountPercent`, is worked out on the subtotal, and is
  kept in the print snapshot (`discountBasisPoints`) so a draft reopens in %
  and the PDF says "Discount (10%)".
- **Round-off stays to the nearest rupee, half-up**, as Tally, Zoho ("nearest
  whole number") and ERPNext's rounded total do; the panel and PDF show it as
  its own row. MRP is not a discount. The Rate is the
  transaction value (CGST Act s. 15), and "N% off" is display only.
- **`invoice.quote`** (new, `invoice: ["create"]`). It takes the invoice
  input without `draft`, runs `resolveInvoice` and writes nothing. It returns
  `{ lines: [{ rateBasisPoints }], discountPaise,
taxablePaise, cgstPaise, sgstPaise, igstPaise, roundOffPaise, totalPaise }`,
  lines in request order; the editor computes each line's quantity times rate
  itself. Its refusals are `resolveInvoice`'s own reasons. This follows
  HMS's server quote (`WalkInQuote`) instead of calculating in the browser,
  because the rate depends on the invoice date through the tax schedule.
- **Quote timing.** The form sends only complete lines (item, whole quantity
  of at least 1, valid rate). It sends the quote 300 ms after the last change,
  as a react-query query keyed by that input with `placeholderData` set to the
  previous result, so the panel does not flash. With no complete line, the
  panel shows zeros and sends nothing. A quote refusal shows its message under
  the panel; field errors still come from save and post.
- **Settle contract.** `invoice.post` takes `settle: { payments: [{
paymentMethodId, amount, reference? }] }` with 1–4 lines, each amount above
  zero. The sum must not exceed the invoice total: otherwise
  `SETTLEMENT_EXCEEDS_TOTAL`, and nothing posts. In the same transaction, each
  line posts one `against` Receipt allocated to the Invoice for its amount, in
  line order, after the Invoice is numbered. One Receipt per method keeps each
  money account reconcilable, because a Receipt has one payment method. The
  response `receipt` becomes `receipts: []`. An amount below the total leaves
  the rest outstanding, and `ClaimStatus` already shows partial payment.
  Needs `receipt: ["post"]` as before. Each Receipt is audited as today.
- **Payment lines UI.** Adapted from HMS `opd-settlement-fields.tsx`
  (`nextPaymentLine`, `PaymentBalance`). It keeps `PaymentMethodField` for the
  method. It drops HMS's required reason note and its forced non-cash
  reference: a credit balance is normal in Books, and a reference rule would
  belong on the payment method. Payment lines are not saved with a draft,
  exactly as Paid now is not today. The toast becomes "Invoice INV… posted ·
  ₹X received" when lines were posted.
- **MRP storage.** `items.mrp_paise` is a nullable bigint with a CHECK
  `>= 0`, as `unit_price_paise` has. `document_lines.mrp_paise` is nullable and
  copied from the Item when the line resolves, as `unit` and `hsn_sac` are, so
  a reprint keeps its MRP. The Item Sheet gets an optional MRP field. The
  schema change follows AGENTS.md rule 4: regenerate the baseline, then run
  `bun run db:seed -- --reset` **only after the owner approves the reset at
  that moment**.
- **Layout.** It stays inside `DocumentForm` and its readable column.
  Below `md` everything stacks: header, then the lines as cards, then the
  totals panel full width. The totals panel is a new `InvoiceTotalsPanel`
  in `invoice-summary.tsx` beside `DocumentTotals`, and the form's "Saved
  totals" block goes away. Motion: none (AGENTS.md UI rules).

## Test seams

- `invoice.post` settle (`tests/integration/invoice.test.ts`; the existing
  "counter sale posts an allocated receipt" test moves to the new shape). One
  happy path: two lines, cash and UPI, below the total, post two Receipts
  allocated to the Invoice, and the outstanding amount equals the total minus
  both. One failure: a sum above the total is `SETTLEMENT_EXCEEDS_TOTAL` and
  posts nothing.
- `invoice.quote`, same file. The quoted totals equal the posted Invoice's
  totals for the same input, with a discount and a taxable line.
- MRP, same file. A line stores the Item's MRP, and changing the Item later
  does not change the posted line.
- The form, totals panel, payment lines and PDF are checked in the running app
  at 1440 and 390 px, in light and dark, keyboard only for one full entry.

## Task plan

- [x] Slice 1: Split and partial counter-sale API (riskiest: money posting)
  - Acceptance: the settle contract above; `receipts` in the response; the
    counter-sale test updated; the new happy and failure tests pass; the
    accounting-core counter-sale paragraph matches.
  - Verify: `bun run test` (one session owns it), `bun run check-types`.
  - Depends on: none
  - Owns/Touches: `packages/api/src/routers/invoice.ts` (post handler, postInput),
    `tests/integration/invoice.test.ts`, `docs/specs/accounting-core.md`
    (counter sale), `apps/web/src/components/invoice-form.tsx` (only the
    minimal change that keeps it compiling: send one line for the full total)
  - Interfaces: `settle.payments: Array<{ paymentMethodId: string; amount: string; reference?: string }>`;
    the post result is `{ id, number, receipts: Array<{ id: string; number: string }> }`.
- [x] Slice 2: `invoice.quote`
  - Acceptance: the quote returns the shape above and equals the posted
    totals; it writes nothing (the documents row count is unchanged).
  - Verify: `bun run test`, `bun run check-types`.
  - Depends on: none (touches `invoice.ts` after Slice 1; run sequentially)
  - Owns/Touches: `packages/api/src/routers/invoice.ts` (new procedure),
    `tests/integration/invoice.test.ts`
  - Interfaces: `orpc.invoice.quote` taking `Omit<invoice input, "draft">`.
- [x] Slice 3: Editor layout, line grid and live totals panel
  - Acceptance: the header, grid and footer as described; the Amount column
    and totals update from the quote; Discount lives in the panel; the
    description is the second line; HSN/SAC and GST % show under the item;
    no "Saved totals" block; mobile stacks; Enter still moves field to field
    and Mod+Enter posts.
  - Verify: `bun run check-types`, `bunx oxlint`, and the running app at 1440
    and 390 px in both themes.
  - Depends on: Slice 2
  - Owns/Touches: `apps/web/src/components/invoice-form.tsx`,
    `apps/web/src/components/invoice-lines.tsx`,
    `apps/web/src/components/invoice-summary.tsx`
  - Interfaces: `InvoiceTotalsPanel({ subtotalPaise, quote, stale, error, discount, children })`, where
    `children` is the payment section from Slice 4.
- [x] Slice 4: Payment lines in the totals panel
  - Acceptance: the Received lines, Split payment, Fill, Over by (blocks
    post), and Balance due; empty means a credit sale; the toggle is gone; the
    post sends `settle.payments`; the toast names the amount received; only
    shown with `receipt: ["post"]`.
  - Verify: `bun run check-types`, `bunx oxlint`, and the running app: a full,
    a partial and a two-method counter sale, then the invoice's status.
  - Depends on: Slices 1 and 3
  - Owns/Touches: `apps/web/src/components/invoice-form.tsx`,
    `apps/web/src/components/invoice-payments.tsx` (new)
- [x] Slice 5: MRP
  - Acceptance: the Item Sheet takes an optional MRP; the line stores it; the
    form shows "MRP ₹X · N% off", or "Above MRP" in the destructive colour,
    only for items with an MRP; the PDF shows an MRP column only when a line
    has one; items without MRP look exactly as before.
  - Verify: `bun run db:generate` after deleting the baseline; `bun run test`;
    the dev database reset only after the owner approves it; then the running
    app with an MRP item and a plain item on one invoice.
  - Depends on: Slice 3
  - Owns/Touches: `packages/db/src/schema/items.ts`,
    `packages/db/src/schema/document-lines.ts`, `packages/db/src/migrations/`
    (generated only), `packages/api/src/routers/item.ts`,
    `packages/api/src/routers/invoice.ts` (line resolve, `get` lines),
    `apps/web/src/components/item-sheet.tsx`,
    `apps/web/src/components/invoice-lines.tsx`,
    `apps/web/src/components/pdf/invoice-document.tsx`,
    `tests/integration/invoice.test.ts`
  - Interfaces: `ItemListRow.mrpPaise: bigint | null`; invoice detail lines
    gain `mrpPaise: bigint | null`.
- [x] Slice 6: Owner docs
  - Acceptance: `design.md` §10 describes the invoice editor layout;
    `client-patterns.md` names the quote and payment lines; the work registry
    is current.
  - Verify: `bunx oxfmt --check docs`
  - Depends on: Slices 1–5
  - Owns/Touches: `docs/design.md`, `docs/specs/client-patterns.md`,
    `docs/README.md`

## Out of scope

- Line-level discounts, of any kind.
- Split payment on the Receipt form, or on Bills and Payments.
- Overpayment, change and advances from a counter sale.
- The Bill page redesign (Bills keep their account-line grid).
- Pharmacy batch, expiry and schedule tracking.

## Explicitly deferred

- A reference rule per payment method. Add it when an organization asks.
- A "You saved ₹X" total on the PDF. The per-line MRP column is enough until a
  pharmacy asks for it.
- Refusing a price above MRP. It is a warning only, because services and
  unpackaged goods have no MRP rule.

## Open questions

None. The dev-database reset in Slice 5 is an execution-time confirmation, not
an open decision.
