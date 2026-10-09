# Spec: Invoice editor — live totals, split payment and MRP

Status: verification.
Layout follows [Design](../design.md#10-task-overlays); client query and posting
patterns follow [Client patterns](./client-patterns.md#calls). Delivery fields
follow [Invoice Ship to](./invoice-ship-to.md). Remaining runtime checks are in
the [work registry](../README.md#work-lifecycle).

## Contract

- **Discount is bill-level only.** The ₹/% switch lives in the totals panel.
  Percentage input is kept as `discountBasisPoints` in the print snapshot so a
  draft reopens in % and the PDF says "Discount (10%)". Discount, tax and
  round-off calculations follow [Accounting core](./accounting-core.md#slices).
  MRP is not a discount: Rate is the transaction value (CGST Act s. 15), and
  "N% off" is display only.
- **`invoice.quote`** (`invoice: ["create"]`) takes the invoice input without
  `draft`, runs `resolveInvoice` and writes nothing. It returns
  `{ lines: [{ rateBasisPoints, grossPaise }], discountPaise, taxablePaise,
  cgstPaise, sgstPaise, igstPaise, roundOffPaise, totalPaise }`, lines in request
  order. The editor computes quantity times rate; `grossPaise` is the discounted,
  tax-inclusive line amount. Refusals are `resolveInvoice`'s own reasons.
  Tax and totals come from the server quote, never a client tax formula.
- **Quote timing.** The form sends only complete lines (item, whole quantity
  of at least 1, valid rate). It sends the quote 300 ms after the last change,
  as a react-query query keyed by that input with `placeholderData` set to the
  previous result kept dimmed, so the panel does not flash. With no complete
  line, the panel shows subtotal and Total "—", and sends nothing. A quote
  refusal shows its message under the panel; field errors come from save/post.
- **Settlement** follows [Accounting core](./accounting-core.md#slices):
  `settle.payments` posts one Receipt per line; the post result is
  `{ id, number, receipts: Array<{ id: string; number: string }> }`.
  Each payment amount must be above zero.
- **Payment lines.** Method, amount and optional reference, up to four lines,
  using `PaymentMethodField`. Split payment adds a line pre-filled with what
  remains owed; Fill completes the last line; Over by blocks posting. Empty
  means a credit sale. Lines show only with `receipt: ["post"]`, are not saved
  with a draft, and need neither a reason nor a non-cash reference. A post with
  lines toasts "Invoice INV… posted · ₹X received".
- **MRP.** `items.mrp_paise` and `document_lines.mrp_paise` are nullable
  bigints with CHECK `>= 0`. Line resolution copies the Item's MRP, like its
  unit and HSN/SAC, so later Item edits never change a reprint. Item list rows
  and Invoice detail lines expose `mrpPaise: bigint | null`. The Item Sheet
  offers an optional MRP field. The line compares quantity × MRP with quoted
  `grossPaise`: "MRP ₹X · N% off", or "Above MRP" in the destructive colour.
  The PDF shows an MRP column only when a line has one; without MRP, no hint or
  column appears.
- **Layout** follows [Design](../design.md#10-task-overlays). Below `md`, the
  header, line cards and full-width totals panel stack inside `DocumentForm`.
  `InvoiceTotalsPanel` in `invoice-summary.tsx` accepts
  `{ subtotalPaise, quote, stale, error, discount, children }`; `children` holds
  the payment section. No motion.
  Item metadata is read-only; description is a smaller optional second line.

## Test seams

- `tests/integration/invoice.test.ts` covers split partial settlement,
  `SETTLEMENT_EXCEEDS_TOTAL` with no writes, quoted totals matching posted totals
  with a discount and taxable line, a read-only quote, and MRP snapshots surviving
  Item edits.
- Runtime checks use 1440 and 390 px, both themes, and keyboard-only full entry;
  open checks remain in the [work registry](../README.md#work-lifecycle).

## Out of scope

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
