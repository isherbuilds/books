# Product

Accly Books is online, multi-tenant accounting and billing for Indian
businesses. One Organization is one legal entity with one PAN. An owner and a
chartered accountant (CA) can belong to several Organizations.

## Position

TallyPrime and Zoho Books India already file GST, so compliance coverage is
table stakes. Accly Books competes on ledger integrity (append-only,
reversal-only, locks tied to filed returns), entry speed, many entities under
one login, and later offline use. External demand is unproved. The owner-funded
pilot runs the founder's three entities with the founder's CA. Before an
external launch, run the [CA interviews](./validation/ca-interviews.md) with
five firms. Launch needs three firms to schedule a trial; fewer than two stops
the bet. If firms decline a shared workspace but lose four hours or more per
client each month, reframe as a CA-only tool that reads Tally. Stop if that
loss is under one hour, or if the CA wants to edit a posted entry after a lock.
Price is one price per owner across Organizations, set against Zoho Standard
per entity.

## Scope

- **Live**: tenancy, auth, members, files, audit, security headers, upload
  cleanup; Parties with ledger, Receipts, Payments with TDS (API only), money
  accounts and payment methods, day book and TDS register XLSX (API only).
- **Next**: accounting-core slices 4–7.
- **Evidence-gated**: the table below. This work gets no placeholder route,
  table, permission or navigation entry. It starts only with an observed or paid
  need, a named owner and an accepted vertical-slice spec.

| Increment           | Trigger before a spec                                        |
| ------------------- | ------------------------------------------------------------ |
| Bank reconciliation | A real statement feed or format with an owner                |
| Gateway or portal   | A remote-payment journey with webhook and refund owners      |
| Inventory           | Verified opening stock and signed stock workflows            |
| Period close        | A full year of documents and an agreed lock policy           |
| E-invoicing         | Turnover above ₹5 crore or a customer need, plus an owner    |
| Offline mode        | Evidence that network, UPS and a paper fallback fail         |
| AI assistance       | An owned workflow with consent, provenance, review, failures |

## Language

Use exact staff words in navigation and exact record names in code, never a
generic Transaction, Entry or Account; the [glossary](../CONTEXT.md) holds the
exact terms. A Member is a User's roles in one Organization;
neither is tenant scope. A Party is any counterparty. Money received before
supply is an advance: a liability until an allocation applies it. Never label a
Receipt as the itemized bill. Until the pilot CA approves classifications and
printed fields, no print claims Tax Invoice or Bill of Supply.

## Delivery rules

- Pre-production changes are clean cutovers: no aliases, dual reads or
  compatibility columns.
- A domain ships vertically: schema, permission, guarded API, UI, audit, tests,
  docs and an owner.
- A pilot cutover imports masters and opening balances, never historic
  invoices. The old system becomes read-only.
- Handover is XLSX and PDF. A one-way Tally adapter is evidence-gated.

## Invariants

- Every domain row has `orgId NOT NULL`; every query uses verified scope.
- Posted documents never change. A correction is a linked document or a
  reversal.
- Money, tax, quantities, numbering, configuration and references fail loudly.
- Balances come from journal lines, never from editable summaries.
- AI proposes through the same authorized commands as a person, and model output
  is untrusted input. AI never writes the ledger directly and never bypasses
  tenancy, authorization, provenance, consent or review.
