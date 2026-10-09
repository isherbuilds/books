# Spec: Invoice Ship to and reverse charge line

Status: verification
Delivery fields meet CGST rule 46(o) and 46(e); Tax Invoice reverse-charge text
meets rule 46(p). Remaining runtime checks are in the
[work registry](../README.md#work-lifecycle).

## Contract

- **Storage.** Optional `PrintSnapshot.shipTo: { address: string; stateCode:
  string }` is a printed fact, frozen at post, with no accounting, tax or
  register effect.
  `saveDraft` and `post` write it, `invoice.get` returns it, and amend copies it.
- **Input.** Optional `invoiceFields.shipTo` is a strict object: `address` is
  trimmed, 1–300 characters and may span lines; `stateCode` is `indianStateCode`.
  A blank address is `BAD_REQUEST` and blocks save and post at the field.
- **Form.** "Deliver to a different address" sets the one form value to
  `{ address: "", stateCode: <place of supply> }`; clearing it sets `null`.
  The state stays editable: in a bill-to-ship-to supply (IGST Act s. 10(1)(b)),
  place of supply is the buyer's state, not the delivery state.
- **Printing** follows [Accounting core](./accounting-core.md#slices).
  When no ship-to is set, Bill to is the delivery address and the printed place
  of supply gives its state.
- **Record Sheet.** A Ship to `DetailRow` follows Place of supply.

## Test seams

- `tests/integration/invoice.test.ts` covers ship-to surviving draft save, post
  and amend, and a blank address refusal. Check the form, PDF and Sheet in the
  running app at desktop and 390 px in both themes.

## Out of scope

- Saved shipping addresses on the Party, or several addresses per Party.
- A consignee name or GSTIN, and e-way bill or e-invoice fields.
- Separate ship-to input on Bills, Credit Notes or Receipts; Credit Note PDFs
  retain the source Invoice's delivery snapshot.

## Explicitly deferred

- Outward reverse charge ("Yes") follows the
  [Accounting core gate](./accounting-core.md#deferred).
- A mandatory ship-to field for unregistered recipients at ₹50,000 or more:
  without one, Bill to is the delivery address.
