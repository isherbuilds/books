# Spec: Invoice Ship to and reverse charge line

Status: verification
Authority: the owner's request of 2026-09-25 ("go through actual GST bills… shipped
to and billed to"; "let's ship it"), CGST rule 46.
Supersedes: none

## Problem

A GST tax invoice must show the address of delivery when it differs from the
place of supply (rule 46(o)). For an unregistered recipient at ₹50,000 or more,
it must also show the delivery address with its state name and code (rule
46(e)). It must also say whether tax is payable on reverse charge (rule 46(p)).
An Invoice prints only the Party ("Buyer"), so goods sent to a site or a branch
cannot be invoiced correctly, and no invoice states reverse charge.

## Solution

The Invoice form gets a "Deliver to a different address" checkbox. When
checked, it asks for the delivery address and its state; the state starts at
the place of supply. The PDF prints "Bill to" (the Party) and, when set, "Ship
to" with the address and "State name (code)". A Tax Invoice PDF also prints
"Reverse charge: No". When no ship-to is set, the Bill to address is the address
of delivery and the printed place of supply gives its state.

## User stories

1. As an operator, I want to enter a delivery address that differs from the
   Party's address, so that the printed invoice meets rule 46(o).
2. As an operator, I want a saved or amended draft to keep its delivery
   address, so that I do not enter it again.
3. As a reader of the record, I want to see the delivery address on the Invoice
   Sheet.
4. As the recipient, I want the invoice to say whether reverse charge applies.

## Implementation decisions

- **Storage: the print snapshot, no migration.** The delivery address has no
  accounting, tax or register effect. It is a printed fact, frozen at post, as
  the Party address already is. `PrintSnapshot` gains an optional
  `shipTo: { address: string; stateCode: string }`. Only an Invoice sets it.
  Amend already copies `printSnapshot`, so an amended draft keeps it. This
  follows Zoho Books (a shipping address on the invoice) without ERPNext's
  separate Address records, which the Party model does not have.
- **Contract.** `invoiceFields` gains optional `shipTo`: a strict object with
  `address` (trimmed, 1–300 characters, may span lines) and `stateCode`
  (`indianStateCode`). `saveDraft` and `post` write it into the snapshot;
  `invoice.get` already returns `printSnapshot`.
- **The state is explicit.** It starts at the place of supply but stays
  editable, because in a bill-to-ship-to supply (IGST Act s. 10(1)(b)) the
  place of supply is the buyer's state, not the delivery state.
- **Form.** One form value, `shipTo: { address, stateCode } | null`. The
  checkbox sets it to `{ address: "", stateCode: <place of supply> }` or
  `null`. No separate boolean.
- **PDF.** "Buyer" becomes "Bill to". The "Ship to" section follows it when
  set. "Reverse charge" prints "No" on a Tax Invoice only. Outward reverse
  charge is not modelled, and the accounting-core Reverse charge deferral still
  applies.
- **Record Sheet.** A "Ship to" `DetailRow` after Place of supply. The
  route file has concurrent owner edits; this change only adds lines.

## Test seams

- `invoice.saveDraft` / `invoice.post` / `invoice.amend` / `invoice.get` in
  `tests/integration/invoice.test.ts`: one test. A ship-to survives draft save,
  post and amend. A blank address is refused. The prior art is "header discount
  splits before GST, round-trips drafts".
- The form, PDF and Sheet are checked in the running app. There is no unit
  test for rendering, which matches the existing PDF coverage.

## Task plan

- [x] Slice 1: API contract and storage
  - Acceptance: a draft saved with `shipTo` returns it in
    `printSnapshot.shipTo`; posting and amending keep it; an empty address is a
    `BAD_REQUEST`.
  - Verify: `bun run test -- tests/integration/invoice.test.ts`, `bun run check-types`.
  - Depends on: none
  - Owns/Touches: `packages/db/src/schema/documents.ts` (type only),
    `packages/api/src/lib/schemas.ts`, `packages/api/src/routers/invoice.ts`,
    `tests/integration/invoice.test.ts`
  - Interfaces: `PrintSnapshot["shipTo"]?: { address: string; stateCode: string }`;
    `invoiceFields.shipTo` optional with the same shape.
- [x] Slice 2: Form, record Sheet and PDF
  - Acceptance: the checkbox reveals the address and state, with the state set
    to the place of supply; an empty address blocks save and post at the field;
    a draft reopens with its ship-to; the Sheet shows Ship to; the PDF shows
    Bill to, Ship to with the state name and code, and "Reverse charge No" on
    a Tax Invoice.
  - Verify: `bun run check-types`, `bunx oxlint`, and the running app at
    desktop and 390 px in light and dark: new invoice with ship-to, save
    draft, reopen, post, open the PDF.
  - Depends on: Slice 1
  - Owns/Touches: `apps/web/src/components/invoice-form.tsx`,
    `apps/web/src/components/pdf/invoice-document.tsx`,
    `apps/web/src/routes/$orgSlug/invoices/$invoiceId.tsx` (additive only)
- [x] Slice 3: Owner docs
  - Acceptance: the accounting-core Invoice PDF paragraph names Bill to, Ship
    to and the reverse charge line; the work registry records this change.
  - Verify: `bunx oxfmt --check docs`
  - Depends on: Slice 2
  - Owns/Touches: `docs/specs/accounting-core.md`, `docs/README.md`

## Out of scope

- Saved shipping addresses on the Party, or several addresses per Party.
- A consignee name or GSTIN, and e-way bill or e-invoice fields.
- Ship-to on Bills, Credit Notes or Receipts.

## Explicitly deferred

- Outward reverse charge ("Yes") stays under the accounting-core Reverse
  charge gate.
- Enforcing a ship-to for unregistered recipients at ₹50,000 or more. When none
  is set, the Bill to address is the address of delivery, so the rule is met.

## Open questions

None.
