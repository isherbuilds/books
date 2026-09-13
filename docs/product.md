# Product

Accly Books is an online, multi-tenant accounting and billing system for small
and mid-sized Indian businesses. One Better Auth Organization is one business.
The live product covers the customer, item, invoice, payment and ledger path; it
does not claim to be a complete accounting suite yet.

## Product promise

Each role should finish its day from one consistent, organization-scoped data
set:

- reception creates and finds customers, and raises the work that becomes a
  charge;
- cashiers create itemized financial documents and receipts;
- accountants receive traceable source documents, balanced ledger exports, and
  tax classifications;
- administrators manage configuration, staff access, audit history, and
  operational read models.

## Scope

| Status             | Capabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live**           | Tenant/auth spine, customers and customer codes, items with price and tax, charges, invoices, payments, receipts, credit notes, refunds, double-entry ledger, GST outward register, trial balance, balance sheet, daily collections, unbilled-alert and refund-due worklists, dashboard, files, audit, member administration with reception/cashier/accountant/administrator roles, security headers, upload cleanup, Parties with ledger, accounting-core Receipts (advance/direct), day-book XLSX, and measurement-only sponsor capture |
| **Legacy**         | The outpatient desk (`opd_appointments`, practitioners, departments) and its register report. It still owns the only path from a service to an invoice, so it stays until documents can be raised directly against a customer                                                                                                                                                                                                                                                                                                             |
| **Next**           | Raising an invoice directly against a customer, printer validation, release evidence for the hardened images and headers, and the pilot runbook                                                                                                                                                                                                                                                                                                                                                                                           |
| **Evidence-gated** | Purchases and vendor bills, inventory, bank reconciliation, manual journals, period close, recurring invoices, e-invoicing (IRP/IRN), e-way bills, payment gateway, customer portal, offline mode, and AI assistance                                                                                                                                                                                                                                                                                                                      |

Evidence-gated work gets no placeholder route, table, permission, or navigation
entry. It starts only with a paid/observed need, a named operational owner, and
an accepted vertical-slice spec.

## Language and boundaries

Use exact staff language in navigation and exact record names in code. Avoid a
generic Transaction, Entry, Document, or Account when the actual record is known.

| Staff label | URL                        | Record / code     | Meaning                                                           |
| ----------- | -------------------------- | ----------------- | ----------------------------------------------------------------- |
| Parties     | `/$orgSlug/parties`        | Party             | Any counterparty: customer, vendor, tenant, donor, employee       |
| Customers   | `/$orgSlug/customers`      | Customer          | Organization-local customer identity and code                     |
| Billing     | `/$orgSlug/billing`        | Charge / Invoice  | Organization-wide financial worklists and source documents        |
| Items       | `/$orgSlug/settings/items` | Item              | A priced, taxed thing you sell                                    |
| Reports     | `/$orgSlug/reports`        | Report/read model | Reproducible views over source records; never another write model |
| OPD         | `/$orgSlug/opd`            | OPD Appointment   | Legacy outpatient desk; the current parent of a charge            |

People and access terms:

- **Organization:** one business tenant; never "workspace", "team", or
  "account".
- **User:** a login identity; never tenant scope.
- **Member:** a User's membership and union of roles inside one Organization.
- **Customer:** the party billed, identified locally by a customer code.
- **Payer:** the person or organization handing over money; may differ from the
  Customer.

## Money

Financial vocabulary is precise:

- a **Charge** is a priced billable event with server-snapshotted item and tax
  facts;
- an internal **Invoice** is the immutable itemized supply aggregate; its printed
  classification may be a Bill of Supply or Tax Invoice;
- a **Payment** is money received and a **Receipt** is its proof;
- a **Credit Note** corrects an issued Invoice and a **Refund** returns money;
- money taken before supply is an **Advance Receipt/Credit** and remains a
  liability until allocation.

Payments use four methods: Cash, UPI, Card, and Bank transfer.

A customer may carry an optional Sponsor with payer policy or employee
identifiers for measurement only; it does not change billing — the Invoice
remains addressed to the Customer and an uncovered balance remains outstanding.

One collection may be split across at most four Payment lines. Each non-cash
line requires its reconciliation reference and produces its own Receipt. After
an Invoice is issued, a discount is represented by a Credit Note; recording a
Payment never rewrites the immutable Invoice.

Never label a Payment Receipt as the itemized bill. Exempt supplies, taxable
supplies, and advances have different document requirements. The pilot's
chartered accountant must approve classifications and printed fields. Until that
approval lands, the printed itemized document uses the neutral label **Invoice**
and makes no Tax Invoice or Bill of Supply claim.

The Ledger is a code-owned double-entry projection of Accly Books source
documents. It does not yet accept manual journals, bank reconciliation,
expenses, opening balances, period close, payroll, or inventory accounting.
Handover is XLSX/print first; a one-way Tally adapter is evidence-gated.

## Delivery rules

- Pre-production schema and API changes are clean cutovers. Remove obsolete
  shapes; do not add aliases, dual reads/writes, or compatibility columns.
- Migrations follow the [migration policy](./development.md#code-rules).
- A pilot cutover may import agreed master data. It does not recreate historic
  invoices or use dual entry; the old system becomes read-only.
- New domains ship vertically: schema, permission, guarded API, UI, audit,
  tests, docs, and a real owner together.

## Roadmap gates

| Increment           | Trigger before specification                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Direct invoicing    | The legacy outpatient parent is the only blocker left; a named owner accepts the new document flow         |
| Purchases and bills | Paid scope, a vendor owner, and signed bill/debit-note/payment-out workflows                               |
| Inventory           | Verified opening stock and signed sale/return/purchase/adjustment workflows                                |
| Bank reconciliation | A real statement feed or import format with a named owner                                                  |
| Manual journals     | An accountant owner plus approval and reversal rules                                                       |
| Period close        | A full year of source documents and an agreed lock policy                                                  |
| E-invoicing (IRP)   | Turnover threshold reached or a customer requirement, plus sandbox access and a compliance owner           |
| Gateway/portal      | Real remote-payment journey with webhook, refund, and reconciliation ownership                             |
| Offline mode        | Outage evidence proves network/UPS remediation and controlled paper fallback insufficient                  |
| AI assistance       | Owned workflow with consent, provenance, authorization, source linkage, human review, and failure handling |

Before pilot traffic, walk the role map with the shift lead, validate real
printers, rehearse backups/restores and data import, define cashier handover and
correction authority, and reconcile daily during a staged cutover
([operations](./operations.md#pilot-readiness)).

## Non-negotiable product invariants

- Every domain record has `orgId NOT NULL`; every query uses verified scope.
- Issued financial documents are immutable; corrections are linked documents.
- Money, tax, quantities, numbering, configuration, and cross-domain references
  fail loudly.
- Derived balances come from source transactions, not editable summary fields.
- AI never bypasses tenancy, authorization, provenance, consent, or review.
