# Accounting contract decisions against reference applications

## Question

Check the 19 accounting-core and client-spec questions against ERPNext, Frappe
Books, Zoho Books, Odoo, and another relevant accounting application. Identify
what to adopt, the costs, and the decisions needed before the affected slices.

Research date: 2026-09-10. This report changes neither spec nor implementation.
It supplements the earlier [reference comparison](./reference-spec-alignment-2026-09-10.md)
with transaction-level evidence. Recommendations below supersede the earlier
conversation's recommendation to expand the generic Posting Rule key; they do
not supersede accepted specifications without a subsequent decision.

## Answer

Use ERPNext and Odoo as accounting-model references, Frappe Books for a compact
document workflow, Zoho Books India for explicit settlement and tax workflows,
and LedgerSMB for database-grant and reversal examples. Retain Accly's tenant,
command, and append-only guarantees. None of the references establishes those
guarantees for Accly.

The main change to the earlier recommendation is item 1: use explicit posting
functions with account mappings and tax rates in data. Do not enlarge a generic
debit/credit rule engine merely to represent a bank leg and a party leg. The
inspected open-source implementations resolve those independently.

The advance-account recommendation below is superseded by the
[Zoho walkthrough](./zoho-advance-walkthrough-2026-09-10.md): recommend separate
advance accounts and transfer entries, with five worked cases for CA acceptance.
The CA gate remains open; research does not change the provisional spec contract.
Taxable advances still need their own tax lifecycle.

Items 1–6 need contract decisions before implementation. Items 7–8 may be gated
features. Items 9–12 belong in existing slice acceptance, not a general deferral.

## Evidence

### Scope and versions

GitHub reads used `gh-axi api`. Source claims are pinned to these inspected
revisions; stable-branch snapshots are not claims about the latest release.

| Reference        | Inspected scope                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ERPNext          | `version-15`, `df8b7f9648c2ec4da12db8c4022edc8dd1018c6b`; Payment Entry, allocation utilities, GL cancellation, permission metadata                          |
| Frappe Books     | `master`, `a79a1e3b03f424805ad094e2fd8731d04f84d36f`; Payment, Party, document lifecycle, ledger writer/reversal, autocomplete                               |
| Odoo Community   | `19.0`, `82a1a696d12a32728492e766220487a2db6a4191`; payment accounts/direction, payment register, move lifecycle, reconciliation, ACLs, down-payment invoice |
| Zoho Books       | Official help and API v3; India help where noted; private implementation not inspected                                                                       |
| LedgerSMB        | `master`, `2d4653dba5210675d953af005e9f7bd875bd17ae`; SQL role grants and payment reversal; 1.11 manual used only as versioned documentation                 |
| India Compliance | Official configuration and migration documentation; separate ERPNext app, not Frappe Books functionality                                                     |

### Product comparison

Pros and cons are assessments for using each product as an Accly design reference,
not measured product performance, adoption, or a purchasing recommendation.

| Reference        | Verified pattern                                                                                                                                                                                                                                                                                                                                         | Pros for Accly                                                                                                                            | Costs and limits                                                                                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ERPNext          | Payment Entry builds party, bank, deduction, and tax GL legs explicitly. It separates Pay/Receive from Customer/Supplier control. Separate advance accounts generate GL at reconciliation. [Posting][erp-post], [refund direction][erp-side], [advance allocation][erp-allocate].                                                                        | Most directly useful accounting reference. Clear source for normal settlement, refunds, and two advance treatments.                       | Large ERP surface. Separate Customer/Supplier masters differ from one org-scoped Party. Reconciliation can modify saved metadata and payment ledgers; do not port those behaviors into an append-only model.                                                                        |
| Frappe Books     | Payment debits its To Account and credits its From Account using the header amount. Save precedes Submit. Cancellation writes reversals, but also updates the original reverted flag; transactional deletion has a ledger deletion path. [Payment][books-post], [lifecycle][books-doc], [reversal][books-reverse], [deletion][books-delete].             | Small, readable payment model and compact document workflow. Useful source for understanding account roles without a generic rule engine. | Financial reversal is not strict SQL append-only storage. The inspected Payment filters and Party formulas use customer/supplier assumptions; Accly must validate its refund and dual-role cases explicitly. Its desktop workflow does not establish multi-user cloud recovery.     |
| Zoho Books India | Separate customer/vendor payments, credit-note refunds, taxable Customer Advances, and retainers. Retainer setup recommends Unearned Revenue. [Refunds][zoho-refund], [advances][zoho-advance], [retainers][zoho-retainer].                                                                                                                              | Strong reference for user-visible intent and GST advance capture. Clear place for tax, place of supply, application, and refunds.         | More modules than the pilot needs. Customer/vendor linking uses two master records. Public docs cannot prove transaction locks, DB privileges, journal retention, or exact idempotency. Features can differ by edition and plan.                                                    |
| Odoo             | Payment direction and partner type are independent. Payment method resolves the liquidity account; partner type resolves AR/AP. Reconciliation checks account compatibility. Separate down-payment invoices use a configured account and tax computation. [Accounts][odoo-payment], [reconciliation][odoo-reconcile], [down payments][odoo-downpayment]. | Strong source for exposure side, account resolution, draft/post, and the distinction between unapplied money and a deposit invoice.       | Its bank outstanding and reconciliation machinery is broader than this pilot. Hash guards are application checks, and qualifying documents can reset to draft. Official product documentation does not establish every feature as Community functionality.                          |
| LedgerSMB        | SQL defines separate draft-post and AR transaction roles with explicit grants. Payment reversal inserts a linked transaction and negates stored accounting amounts. [Roles][lsmb-roles], [reversal][lsmb-reverse].                                                                                                                                       | Useful additional reference for a database-owned permission boundary and reversal from original facts.                                    | Stored-procedure and role architecture differs from Accly's oRPC/Drizzle stack. The inspected files do not prove a universal append-only fence. Its 1.11 manual describes configurable reversal enforcement, so that manual must not be read as an unconditional current guarantee. |

### Decisions 1–6

**1. Posting mechanics in code; mappings and rates in data.** ERPNext separates
party and bank legs in `build_gl_map`; Frappe Books uses the payment header amount;
Odoo resolves liquidity and counterpart accounts separately. None of these
inspected paths needs a universal item-line debit/credit pair. [ERPNext][erp-post],
[Books][books-post], [Odoo][odoo-payment].

Recommendation: replace the proposed Posting Rule pair model with explicit,
typed posting functions. `settlementKind` and `exposureSide` select behavior;
Payment Method, selected line Account, and dated system-account mappings supply
accounts. Rates remain dated data. Do not hard-code account IDs, rates, or names.
One balanced-entry writer persists the result. A reversal reads stored lines.
Legal type seeds mappings rather than multiplying every runtime rule key.

Benefit: fewer ambiguous matches and no synthetic item line for an advance.
Cost: a new accounting event can require code, not only editable rows. That is
appropriate for the finite document set. Retaining a generic Posting Rule engine
would instead require an explicit document/line amount basis, finite symbolic
targets, deterministic precedence, and tie/missing-match rejection. It is the
larger option, not a free schema extension.

**2. Persist exposure side independently of cash direction.** ERPNext explicitly
handles Receivable+Pay and Payable+Receive. Odoo separately stores inbound/outbound
and customer/supplier and selects a receivable account for customer refunds.
Zoho exposes refunds under customer Credit Notes. [ERPNext][erp-side],
[Odoo][odoo-payment], [Zoho][zoho-refund].

Recommendation: use `receivable | payable | null`. Notes inherit side from their
source; standalone Notes require it. Direct cash-to-income/expense documents
have no party exposure. Each settlement document uses one Party and side;
allocations validate Organization, Party, compatible control, posted state,
opposite residual direction, and amount. Party role flags remain descriptive.
Do not infer a supplier Payment merely from money going out. Mixed-side netting
is a later explicit workflow. Zoho's netting example still records both payment
sides separately. [Linked Customer/Vendor][zoho-link].

Benefit: refunds and a Party with both roles remain unambiguous. Cost: one more
required fact, with validation against source documents. Prefer that cost to
re-deriving authorization/accounting intent from master flags.

**3. One control per side is a pilot choice, not a universal advance model.**
ERPNext supports normal unallocated payments and a separate-account mode; its
allocation code branches to `make_advance_gl_entries` for the latter. Odoo
documents unapplied customer/vendor payments and separately implements
down-payment invoices. Zoho recommends a liability for retainers.
[ERPNext allocation][erp-allocate], [Odoo payments][odoo-payments-doc],
[Odoo down payments][odoo-downpayment], [Zoho retainers][zoho-retainer].

For the pilot, recommend principal advances in the existing AR/AP controls and
CA-approved financial-statement classification. Confirm the permitted grouping
and offset rules; splitting an aggregate account balance by sign is insufficient.
Even netting within one Party may hide balances that must be presented separately.
No inspected source proves that Accly's proposed Statement Definition meets
Schedule III or the requirements of all its legal types.

Single-control advantage: ordinary same-currency, non-tax-bearing allocation
does not need a principal transfer entry. Cost: presentation needs disciplined
grouping, and taxable advances remain unsupported until their own event flow
exists. Separate-account advantage: advance balances are explicit in the ledger.
Cost: transfer, partial application, unapplication, refund, and cancellation need
linked accounting events. For an illustrative non-taxed customer advance, the
separate-account treatment is receipt Dr Bank / Cr Advances, followed by
application Dr Advances / Cr Receivables. This illustration is accounting
reasoning, not an observed Zoho journal.

Ask the CA before `recordEntry` is built whether separate ledger accounts are
required now or separate presentation is sufficient. If separate accounts are
required, widen the entry source to explicit allocation events and settle undo
semantics before coding. Remove “changes only the posting rule rows.” Do not
build both advance modes speculatively. Do not promise that all future
allocations are journal-free: India Compliance reverses advance GST at supply.
[GST advance lifecycle][india-advance].

**4. Receipt accepts a full payload; saved drafts have an explicit versioned
posting variant.** Frappe Books saves then submits. Odoo rejects creating a move
already posted and posts existing records. Zoho Customer Payments has a creation
payload API. These are compatible with one atomic Accly command: internal
create/post steps need not be two client requests. [Books lifecycle][books-doc],
[Odoo creation][odoo-create], [Zoho API][zoho-payment-api].

Recommendation: one Receipt post command creates and posts from a full payload;
remove unused Receipt draft creation. Draft-enabled document types accept either
`mode: new` plus payload or `mode: draft` plus ID and expected version. Explicit
Save/Update Draft commands precede the latter. Reject stale versions, but check
committed command replay first. Preserve the exact chosen command envelope.

Benefit: fast Receipt interaction, durable Invoice drafts, precise recovery.
Cost: two explicit input variants for draft-enabled types. Do not silently save
unsaved edits in a hidden second request when posting a draft ID.

**5. Keep SQL append-only as an Accly guarantee and give its infrastructure to
slice 1.** Books updates reverted flags and has deletion machinery. ERPNext
immutable mode preserves financial originals, but the separate-advance partial
cancellation path still updates metadata. Odoo protects hashed fields in its
ORM. None proves that a direct SQL update fails. [Books][books-reverse],
[ERPNext][erp-immutable], [Odoo][odoo-hash]. LedgerSMB's SQL grants provide a more
relevant infrastructure example. [LedgerSMB roles][lsmb-roles].

Recommendation: schema-owner/migrator credential, restricted application
credential, no app ownership or ability to assume the owner, and explicit
SELECT/INSERT grants on append-only tables. Withhold UPDATE, DELETE and TRUNCATE.
Slice 1 owns provisioning, env/config, Compose/bootstrap, migration/reset scripts,
test-role setup, and operations documentation. Later slices apply the policy to
their new tables. Reset tests as the privileged role; execute router and direct
mutation assertions as the app role. PostgreSQL ownership and TRUNCATE privileges
are separate considerations. [PostgreSQL privileges][pg-privileges].

Benefit: an enforceable stored-history boundary. Cost: real environment and test
setup. A UI guard or optional hash flag does not satisfy this acceptance.

**6. Per-type/action grants and own-command recovery.** ERPNext DocType metadata
distinguishes create, write, submit, cancel and amend. Zoho Custom Roles select
modules and access. These support action granularity, not their broad defaults.
[ERPNext grants][erp-grants], [Zoho roles][zoho-roles].

Recommendation: explicit Receipt, Payment, Invoice, Bill, Note, Journal and
OpeningBalance actions. Operators can create/post the first three and read the
records/masters needed to complete and print them. Embedded settlement in an
authorized post belongs to that command; later allocation apply/reverse and
cancel need distinct grants. Expose minimal settlement targets, including
customer Credit Notes for refunds, without granting general Note administration.

Assign `command:readOwn` explicitly to all supported member roles. Enforce current
Organization membership and original actor identity. Losing posting permission
must not hide one's earlier command result; losing membership must revoke access.
The references do not establish an equivalent recovery contract. Accly must state
and test it. Benefit: least privilege without an unresolved-post trap. Cost: a
clear permission matrix plus a narrow status endpoint.

### Items 7–19 and documentation ownership

| Item                     | Final recommendation                                                                                                                                                                                                                                                                                             | Evidence and limit                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7, RCM                   | Explicitly defer automated RCM only with a gate before the first applicable transaction: implement it or obtain a CA-approved manual posting and return-reconciliation process.                                                                                                                                  | India Compliance and Zoho document RCM workflows. Their feature docs do not determine legal applicability to every security/legal/transport purchase. [India purchases][india-purchase], [Zoho vendor advances][zoho-vendor-advance].                                               |
| 8, service advances      | Gate the first taxable service advance on tax capture, tax settlement/reversal, voucher/report treatment and CA verification. Never silently pass it through a “Receipt never computes tax” path.                                                                                                                | Zoho has a distinct Customer Advance flow with tax and place of supply; India Compliance documents advance GST and its later reversal. GST Portal guidance confirms service-advance liability. [Zoho][zoho-advance], [India Compliance][india-advance], [GST Portal][gst-advances]. |
| 9, opening position      | One cutover position, not an annual repeat over cumulative balances. Reconcile migrated open documents with the residual opening journal so controls are not counted twice. Annual closing is a separate deferred capability.                                                                                    | [ERPNext migration/closing][erp-opening], [Odoo setup][odoo-opening], [Zoho opening date][zoho-opening].                                                                                                                                                                            |
| 10, external reference   | Same external key plus same canonical business digest returns the original result; different digest returns CONFLICT. Exclude command/device metadata from the external business digest.                                                                                                                         | No equivalent exact contract established in inspected references. Zoho reference numbers and Odoo duplicate-payment heuristics are not proof of idempotency. [Zoho API][zoho-payment-api], [Odoo heuristic][odoo-duplicates].                                                       |
| 11, Party collision      | Unique normalized non-null GSTIN is an Accly accounting-Party invariant if one row represents that tax registration. Keep locations/contacts distinct. Name collision returns candidates and requires explicit namesake resolution; do not make display name an identity. Handle concurrent creates server-side. | ERPNext permits same-name Customers; Zoho allows duplicate names by preference; Odoo computes Tax ID matches rather than proving blanket uniqueness. [ERPNext Customer][erp-customer], [Zoho duplicate names][zoho-duplicates], [Odoo partners][odoo-partner].                      |
| 12, lock ordering        | Define and apply a single order across posting/allocation/cancellation. Acquire affected document rows in ascending ID order, recheck eligibility/outstanding, and retry if the discovered affected set changed. Use the original command identity.                                                              | No universal sorted-lock guarantee established in reviewed competitor paths. This is a local transaction requirement, not an inferred competitor bug.                                                                                                                               |
| 13, arrow keys           | Arrows move local row focus; Enter opens the route. Keep focused row separate from open-document route ID. Preserve focus/scroll on Back.                                                                                                                                                                        | A local interaction choice. Books autocomplete distinguishes highlight and activation, but that is not proof of list-route behavior. [Autocomplete][books-autocomplete].                                                                                                            |
| 14, sessionStorage       | Add the narrow unresolved-command exception to Development in client slice 1. No general query/form persistence is authorized.                                                                                                                                                                                   | Internal owner contradiction; competitors cannot resolve it. [Development](../development.md).                                                                                                                                                                                      |
| 15, Billing alone        | Acknowledge Account dependency now and remove the promise that enabling Billing alone requires no contract changes. Nullable Payment Method mapping alone does not remove direct-account and supplyClass dependencies.                                                                                           | ERPNext/Odoo payment paths depend on accounts. A separately scoped billing-only boundary remains future work.                                                                                                                                                                       |
| 16, Palette cancel       | Open a reason-and-confirm dialog. The palette action never executes cancellation directly.                                                                                                                                                                                                                       | Accly's reason/audit contract decides this; no competitor consensus claimed.                                                                                                                                                                                                        |
| 17, seed ownership       | Core slice 2 owns the accounting volume-seed rewrite; client slice 3 consumes it.                                                                                                                                                                                                                                | The existing `scripts/seed-volume.ts` imports legacy Customer models. No competitor evidence is relevant.                                                                                                                                                                           |
| 18, stale paths/registry | Correct migrations to `packages/db/src/migrations/`; supersede the Customer-fields work with the Party work while retaining needed acceptance.                                                                                                                                                                   | Internal ownership correction, not deferred capability.                                                                                                                                                                                                                             |
| 19, precision            | User-scoped Lock Exceptions first. Starting retry proposal: 15-second request timeout, three retries at approximately 1/2/4 seconds with jitter; stop auto-retries for auth denial, retain unknown outcome. Use the design owner's 300 ms search debounce. Counterbalance H4 tool order.                         | These are proposed local defaults, not measured or competitor-derived constants. Account-scoped exceptions need their own matching semantics before being added.                                                                                                                    |

Point guidance at the accounting spec/CONTEXT for target vocabulary now. The
checked-in Product document still describes legacy behavior; do not imply the
planned model is already implemented. Update those behavioral owners in slice 7
as planned. “Open Questions: None” is inaccurate while the CA advance treatment
remains unresolved. Keep 7–8 under gated deferrals and 9–12 in slice acceptance.

## What this proves / does not prove

This evidence establishes inspectable implementation patterns and documented
workflows. It does not certify this spec, demonstrate statutory completeness,
prove runtime performance, establish feature availability in every edition, or
prove safe behavior under Accly's concurrency and tenant model.

No product was used to post, cancel, allocate, or alter a financial record during
this investigation. No source was copied into product code. No production tests,
UI timing, database-role mutation tests, or GSTR export validation were run.
Absence of an exact idempotency/lock/recovery contract in the inspected sources
is a bounded research result, not proof that a whole product lacks safeguards.

## What this means for us

Keep the existing stack and one implementation owner. Revise the spec contracts
before writing their tables and entry writer. Use reference accounting events
and account roles, while retaining explicit org scope, exact command recovery,
stored reversal facts, and restricted SQL grants. Do not add a general-purpose
rules language, a full reconciliation framework, a second Party master, or two
advance modes merely because a reference product has them.

## Next falsification

Before implementing `recordEntry`, ask the CA to approve worked examples for:
customer advance then partial application; customer Credit Note refund; supplier
Debit Note against a Bill; shared Receipt unallocation then cancellation; and
cutover with both open invoices and an advance. Confirm principal presentation
and tax timing separately. A requirement for separate advance ledger accounts
falsifies the single-control pilot recommendation and changes the allocation
entry source before coding.

When implementation is authorized, prove the actual local guarantees: restricted
role denies journal mutation, replay survives a lost response and role change,
and concurrent allocation/cancellation preserve exposure. Reference source
inspection cannot replace those checks.

## Sources

Pinned source and official documentation links used above:

[erp-post]: https://github.com/frappe/erpnext/blob/df8b7f9648c2ec4da12db8c4022edc8dd1018c6b/erpnext/accounts/doctype/payment_entry/payment_entry.py#L1297-L1310
[erp-side]: https://github.com/frappe/erpnext/blob/df8b7f9648c2ec4da12db8c4022edc8dd1018c6b/erpnext/accounts/doctype/payment_entry/payment_entry.py#L1328-L1373
[erp-allocate]: https://github.com/frappe/erpnext/blob/df8b7f9648c2ec4da12db8c4022edc8dd1018c6b/erpnext/accounts/utils.py#L460-L520
[erp-immutable]: https://github.com/frappe/erpnext/blob/df8b7f9648c2ec4da12db8c4022edc8dd1018c6b/erpnext/accounts/general_ledger.py#L679-L778
[erp-grants]: https://github.com/frappe/erpnext/blob/df8b7f9648c2ec4da12db8c4022edc8dd1018c6b/erpnext/accounts/doctype/payment_entry/payment_entry.json#L809-L842
[erp-opening]: https://docs.frappe.io/erpnext/opening-and-closing
[erp-customer]: https://docs.frappe.io/erpnext/customer
[books-post]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/baseModels/Payment/Payment.ts#L330-L368
[books-doc]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/fyo/model/doc.ts#L1012-L1035
[books-reverse]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/baseModels/AccountingLedgerEntry/AccountingLedgerEntry.ts#L16-L38
[books-delete]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/Transactional/Transactional.ts#L73-L96
[books-autocomplete]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/src/components/Controls/AutoComplete.vue#L33-L41
[odoo-payment]: https://github.com/odoo/odoo/blob/82a1a696d12a32728492e766220487a2db6a4191/addons/account/models/account_payment.py#L620-L646
[odoo-reconcile]: https://github.com/odoo/odoo/blob/82a1a696d12a32728492e766220487a2db6a4191/addons/account/models/account_move_line.py#L2651-L2687
[odoo-downpayment]: https://github.com/odoo/odoo/blob/82a1a696d12a32728492e766220487a2db6a4191/addons/sale/wizard/sale_make_invoice_advance.py#L140-L220
[odoo-create]: https://github.com/odoo/odoo/blob/82a1a696d12a32728492e766220487a2db6a4191/addons/account/models/account_move.py#L3900-L3904
[odoo-hash]: https://github.com/odoo/odoo/blob/82a1a696d12a32728492e766220487a2db6a4191/addons/account/models/account_move.py#L3919-L3938
[odoo-payments-doc]: https://www.odoo.com/documentation/19.0/applications/finance/accounting/payments.html
[odoo-opening]: https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started.html
[odoo-duplicates]: https://github.com/odoo/odoo/blob/82a1a696d12a32728492e766220487a2db6a4191/addons/account/wizard/account_payment_register.py#L912-L921
[odoo-partner]: https://github.com/odoo/odoo/blob/82a1a696d12a32728492e766220487a2db6a4191/odoo/addons/base/models/res_partner.py#L451-L487
[zoho-refund]: https://www.zoho.com/in/books/help/credit-note/refund-credits.html
[zoho-advance]: https://www.zoho.com/in/books/help/payments-received/functions.html
[zoho-retainer]: https://www.zoho.com/in/books/help/retainer-invoice/basic-functions.html
[zoho-link]: https://www.zoho.com/in/books/help/contacts/link-customer-and-vendor.html
[zoho-payment-api]: https://www.zoho.com/books/api/v3/customer-payments/
[zoho-vendor-advance]: https://www.zoho.com/in/books/help/payments-made/vendor-advance.html
[zoho-roles]: https://www.zoho.com/in/books/help/settings/users.html
[zoho-duplicates]: https://www.zoho.com/in/books/kb/contacts/display-duplicate-contact-name.html
[zoho-opening]: https://www.zoho.com/in/books/help/settings/opening-balances.html
[india-advance]: https://docs.indiacompliance.app/docs/configuration/other_transaction
[india-purchase]: https://docs.indiacompliance.app/docs/configuration/purchase_transaction
[lsmb-roles]: https://github.com/ledgersmb/LedgerSMB/blob/2d4653dba5210675d953af005e9f7bd875bd17ae/sql/modules/Roles.sql#L641-L673
[lsmb-reverse]: https://github.com/ledgersmb/LedgerSMB/blob/2d4653dba5210675d953af005e9f7bd875bd17ae/sql/modules/Payment.sql#L1244-L1295
[pg-privileges]: https://www.postgresql.org/docs/current/ddl-priv.html
[gst-advances]: https://tutorial.gst.gov.in/contextualhelp/Einv/GSTR_1.htm
