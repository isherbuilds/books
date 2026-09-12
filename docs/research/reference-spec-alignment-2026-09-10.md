# Reference comparison: accounting core and client patterns

## Question

Are both active specs directionally aligned and good when compared with Frappe
Books on macOS, the Zoho Books demo, SFab Starter, and Midday?

Scope: the working-tree versions of [accounting core](../specs/accounting-core.md)
and [client patterns](../specs/client-patterns.md), inspected on 2026-09-10.
This is a research assessment. It changes neither spec nor product code.

## Revision disposition

The user authorized the spec revisions on 2026-09-10. Both specs now define
same-tab reload recovery, explicit master overflow, keyboard event ownership,
report-based tax locks, the persisted place-of-supply input, settled-document
cancellation, and due-date/settlement display. They exclude the Midday optimistic
rollback from financial posting and use the measured five-line H4 baseline.
The findings below describe the pre-revision specs and are retained as evidence;
the linked specs own the revised contracts. Their implementation and runtime
acceptance remain outstanding. This disposition supersedes the recommendation
to make those contract edits, not the evidence limits or pilot gates.

## Answer

**Yes on direction. Revise several contracts before treating the specs as ready
to implement without further decisions.** Keep document-driven accounting,
explicit organization scope, immutable issued facts, linked settlements, and the
Receipt as the first complete interaction. Keep the existing stack. The reference
evidence below supports those choices; it does not prove accounting correctness,
operator speed, or external demand.

The strongest combination is Frappe's direct accounting workflow, Zoho's visible
document and settlement context, Midday's navigation and form patterns, and SFab's
domain separation. This is a design inference from the evidence below, not a
recommendation to copy all four architectures.

## Evidence

### Application observations

These are direct observations from Computer and Browser on 2026-09-10. No
financial record was saved, submitted, cancelled, or paid. The native app version
was not established; its UI observations are separate from the pinned source.

| Reference and surface                                                                             | Observed behavior                                                                                                                                                                      | Implication for the specs (inference)                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frappe Books, native Sales Invoice form, `app://./edit/SalesInvoice/...`                          | An existing unsaved form showed Draft, Customer, Account, Date, item rows, quantity, rate, tax, totals, outstanding, notes, and attachment. Save and Create were visible.              | A concrete document form with linked masters and visible totals is sound. This observation does not prove that a narrow receipt overlay fits a multi-line invoice. |
| Frappe Books, native Dashboard, `app://./`                                                        | Cashflow, paid/unpaid Sales and Purchase Invoice summaries, P&L, and top expenses appeared in a persistent sidebar shell.                                                              | The accounting categories fit. Dashboard breadth is not a reason to expand the first proof slice.                                                                  |
| Frappe Books, Shortcuts help over Dashboard                                                       | Help listed Mod+K search, Mod+S save/submit, Mod+P print, Mod+L linked entries, and list create/export shortcuts.                                                                      | Contextual shortcuts and discoverable help have direct prior art. Exact Accly Enter/Tab behavior remains its own choice.                                           |
| [Zoho dashboard](https://www.zoho.com/us/books/accounting-software-demo/#/home/dashboard)         | Receivables, payables, cashflow, income/expense, bank accounts, and quick search. Sales navigation distinguishes Invoices, Payments Received, and Credit Notes.                        | Preserve distinct documents and money movement in staff language.                                                                                                  |
| [Zoho invoice list](https://www.zoho.com/us/books/accounting-software-demo/#/invoices)            | Columns include document date, invoice number, customer, status, due date, amount, and balance due. Pagination exposes page size.                                                      | Define due-date and derived settlement-status behavior alongside the existing list pattern.                                                                        |
| [Zoho invoice detail](https://www.zoho.com/us/books/accounting-software-demo/#/invoices/2)        | Partially Paid state, available credits with Apply Now, Record Payment, PDF/Print, and Comments & History. The preview explicitly says it is a sample PDF.                             | Put allocation and print actions beside the document and show remaining exposure. A workflow walkthrough must also cover corrections.                              |
| [Zoho payment entry](https://www.zoho.com/us/books/accounting-software-demo/#/invoices/2/payment) | Customer is carried in; amount, date, payment mode, deposit account, reference, notes, bank charges, and deduction controls are visible. The untouched form was closed without saving. | Accly's against-invoice receipt flow and payment-method account mapping are aligned. Extra controls are an inventory, not permission to add them.                  |
| [Zoho Reports Center](https://www.zoho.com/us/books/accounting-software-demo/#/reports)           | P&L, balance sheet, trial balance, general ledger, receivable/payable balances and ageing, payment and refund reports are listed.                                                      | The core report families fit. Report discovery alone cannot validate calculations or exports.                                                                      |

**Observation limits:** Frappe navigation became unreliable. Native actions
returned unchanged state and intermittent window/capture errors despite
reconnection. The invoice form, dashboard, and shortcut help were readable, but
an end-to-end native create/post/settle/cancel walkthrough was not completed.
Zoho identifies itself as a restricted demo. Its sample preview, status, currency,
and amounts are not consistently reconcilable across these screens. Treat these
observations as interface evidence only. No production behavior is inferred from
those demo figures.

### Source comparison and architecture transfer

Revisions inspected: Frappe `a79a1e3b03f424805ad094e2fd8731d04f84d36f`,
SFab `b26ed0d96413a5019c444f9fc36052ecf08c5fdf`, Midday
`51587319f26a0ffaa9dfccab1920373cb65689b7`. SFab and Midday were read from
existing clean source checkouts. These are inspected versions, not a claim that
they equal today's main branches. Midday matches the pin in the client spec.

| Area                       | Source evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | What this means for Accly                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document lifecycle         | Frappe checks submit/cancel transitions and creates postings through lifecycle hooks. [Doc](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/fyo/model/doc.ts#L1012-L1035), [Transactional](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/Transactional/Transactional.ts#L22-L70). SFab guards draft edits and finalization. [Documents](https://github.com/sfab-oss/sfab-starter/blob/b26ed0d96413a5019c444f9fc36052ecf08c5fdf/packages/core/src/transaction/documents.ts#L26-L73).                                                        | Supports core calls 1–3. Atomic posting and print snapshots remain Accly acceptance requirements.                                                                                                           |
| Reversal and settlement    | Frappe reverses debit/credit but also updates the original reverted flag; a deletion path removes ledger rows. Payment cancellation restores outstanding. [Reversal](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/baseModels/AccountingLedgerEntry/AccountingLedgerEntry.ts#L16-L38), [deletion](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/Transactional/Transactional.ts#L73-L96), [Payment](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/baseModels/Payment/Payment.ts#L503-L524). | Keep append-only allocations and ledger guards. Frappe is not proof of the exact immutable design proposed here.                                                                                            |
| Structure and storage      | Frappe uses a selected SQLite file. SFab uses D1 batches. Midday's dashboard is Next-based. [Frappe DB](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/backend/database/core.ts#L48-L65), [SFab payment constraints](https://github.com/sfab-oss/sfab-starter/blob/b26ed0d96413a5019c444f9fc36052ecf08c5fdf/packages/core/src/transaction/payments.ts#L19-L29), [Midday manifest](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/package.json).                                                                                | Retain Postgres transactions, bigint paise, and the Billing → recordEntry seam in core calls 1, 2, and 14. No migration benefit was established.                                                            |
| Auth                       | SFab's permission middleware resolves membership from session.activeOrganizationId. Midday's dashboard sends a Supabase token in its tRPC client. [SFab middleware](https://github.com/sfab-oss/sfab-starter/blob/b26ed0d96413a5019c444f9fc36052ecf08c5fdf/apps/web/src/hono/middleware/auth.ts#L38-L70), [Midday client](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/trpc/client.tsx#L48-L68).                                                                                                                                                        | Keep route orgSlug and the existing permission-bound [orgProcedure](/Users/docbook/accly-ai/books/packages/api/src/lib/procedures/factory.ts:92). These references do not justify a second auth convention. |
| Routing                    | Midday puts selected transaction, creation, and editing in URL parameters. Frappe composes form/list views with named outlets. [Midday params](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/hooks/use-transaction-params.ts), [Frappe routes](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/src/router.ts#L1-L49).                                                                                                                                                                                                      | Client call 8 translates the useful behavior into TanStack routes. Keep that translation rather than adding nuqs or Vue machinery.                                                                          |
| Data access                | SFab's inspected document query key omits org identity. Midday uses tRPC Query infrastructure. [SFab hook](https://github.com/sfab-oss/sfab-starter/blob/b26ed0d96413a5019c444f9fc36052ecf08c5fdf/apps/web/src/hooks/use-documents.ts#L37-L47), [Midday provider](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/trpc/client.tsx).                                                                                                                                                                                                                        | Keep one oRPC client and orgSlug on queries and invalidations. This is not a whole-app security finding against either reference.                                                                           |
| Forms and master selection | Frappe Link filters masters, appends Create, then selects the saved row back into the parent. SFab uses RHF, Zod and field errors. [Frappe Link](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/src/components/Controls/Link.vue#L60-L185), [SFab form](https://github.com/sfab-oss/sfab-starter/blob/b26ed0d96413a5019c444f9fc36052ecf08c5fdf/apps/web/src/components/documents/document-create-form.tsx#L64-L96).                                                                                                                                                              | Client calls 1, 9 and 11 have good prior art. Build Receipt concretely, then extract at Invoice.                                                                                                            |
| Keyboard discovery         | Midday has a Mod+K search dialog and adjacent-row arrow movement. Frappe autocomplete selects on Enter but closes on Tab/Esc. [Search](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/search/search-modal.tsx), [arrows](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/tables/transactions/data-table.tsx#L522-L544), [autocomplete](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/src/components/Controls/AutoComplete.vue#L33-L41).        | Conventional shortcuts are justified. Accly's Tab-to-commit is a different choice and needs its own interaction test.                                                                                       |

## What this proves / does not prove

The evidence supports the **shape** of both specs. It does not certify their
implementation or make the full suite pilot-ready. Neither Accly nor Tally was
timed in this investigation. The client spec itself labels its 38/48-key figures
as estimates and requires a human-operated H4 comparison. Its five-line invoice
benchmark must replace the two-line estimate rather than use that estimate as a
pass threshold. [H4 protocol](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:23).

External demand remains unproved, as the core spec already states. The reference
apps cannot prove cutover ease, CA acceptance, or demand for an owner with several
entities. [Pilot evidence](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:15).
This investigation does not validate GST/TDS law, seed rates, document
classification, or statutory completeness. Those need the named CA and current
authoritative tax sources.

Bounded absences: no Accly-style immutable allocation/replay model was established
in the inspected Frappe lifecycle files; no complete general-ledger proof was
established in SFab's document/payment owners; Midday's transaction editor does
not establish the proposed five-state financial posting contract. None of these
is a repository-wide claim that the capability is absent.

## What this means for us

### Resolve before the affected slice

1. **Preserve uncertain posting identity across reload before the pilot.** A
   command can commit, lose its response, and then lose its in-memory ID on reload.
   Re-entry creates a new ID, so server replay protection cannot connect the two.
   The instruction to check the list is a manual mitigation, not the claimed
   no-duplicate guarantee. Specify minimal recovery of pending command identity
   with organization/user isolation, or narrow the guarantee and explicitly accept
   that pilot limitation. This is a reachable scenario inferred from the spec,
   not an observed production defect. [Promise](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:18),
   [lifecycle](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:65),
   [deferral](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:138).
2. **Use report impact consistently for tax locks.** Call 7 locks tax-affecting
   documents; call 16 puts some zero-tax direct Receipts into the outward register;
   slice 5 locks only documents with tax lines. Under the latter predicate those
   receipts can change a locked register. Align the predicate and acceptance with
   the spec's own reporting policy. Also add the explicit persisted
   placeOfSupplyStateCode input to computeTax: call 5 requires it, but the slice 4
   signature omits it. These are internal contradictions, independent of a
   tax-law opinion. [Lock rule](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:62),
   [receipt rule](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:79),
   [acceptance](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:127),
   [tax contract](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:124).
3. **Define cancellation from both ends of a settlement.** Receipt cancellation
   is specified; a partially settled Invoice/Bill needs an explicit result for
   cash, released allocations, remaining credit, and locks. Choose whether to
   block cancellation until deallocation or release allocations while preserving
   the money already received. Frappe cancels linked payments when an invoice is
   cancelled; copying that behavior is not automatically appropriate for this
   model. [Accly acceptance](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:120),
   [Frappe cancellation](https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/baseModels/Invoice/Invoice.ts#L340-L365).
4. **Keep financial outcome separate from optimistic cache rollback.** The
   requested Midday adaptation restores cached data on error. Accly correctly
   requires unknown for unproven outcomes. Limit the adaptation to explicitly
   safe presentation state; a cache rollback cannot prove non-commit or authorize
   a fresh posting attempt. [Adaptation directive](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:85),
   [outcome owner](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:65),
   [Midday implementation](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/forms/transaction-edit-form.tsx#L83-L168).
5. **Name keyboard event ownership.** Esc must close the innermost surface while
   the registry ignores unmodified keys inside fields. Specify the Base UI/form
   exception and prevent a single Esc from closing two layers. Keep multiline
   input and link-selection behavior explicit. Also correct the stale four-state
   PostBar wording to match the five-state owner. [Keyboard rules](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:67),
   [PostBar wording](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:73).
6. **Specify master-list overflow without silent truncation.** A complete list
   capped at 5,000 needs an overflow result or an enforced pilot bound. If truncated
   data is treated as complete, a real Party can appear absent and trigger inline
   creation of a duplicate. This is a conditional implementation risk, not a
   claim that truncation exists today. [Cache contract](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:64),
   [Create behavior](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:71).

### Clarify product fit without expanding to suite parity

**Due dates and settlement visibility need a decision.** The specified Document
header and invoice acceptance do not define due dates/payment terms, and the
client detail acceptance does not name unpaid/part-paid/paid labels. Zoho's list
and reports make these concepts visible. Recommendation: decide whether the pilot
needs due dates; derive settlement labels from allocations rather than adding
them as competing write states beside draft/posted/cancelled. This is a product
recommendation, not a mandatory copy of Zoho. [Document header](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:42),
[client Invoice acceptance](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:118),
[Zoho list](https://www.zoho.com/us/books/accounting-software-demo/#/invoices),
[Zoho reports](https://www.zoho.com/us/books/accounting-software-demo/#/reports).

**Keep the first delivery narrow.** Prove core slices 1–2 with client slice 1,
then expand. The specs already delay shared form extraction until Invoice and
leave inventory, reconciliation, offline sync, and AI outside this build. The
reference inventory does not justify reopening those boundaries.
[Proof slice](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:105),
[client proof](/Users/docbook/accly-ai/books/docs/specs/client-patterns.md:96),
[scope](/Users/docbook/accly-ai/books/docs/specs/accounting-core.md:149).

The existing Midday commercial-license release gate remains a project constraint;
this review does not resolve it or offer a legal compatibility conclusion.
[Project registry](/Users/docbook/accly-ai/books/docs/README.md:25),
[pinned Midday license](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/LICENSE).

## Next falsification

After revising the contracts, use the existing acceptance work to try to disprove
the design:

1. Post a receipt, lose the response, reload, and recover the same numbered
   document. Repeat with permission revoked after commit. No fresh ID should
   conceal an unresolved prior result.
2. Allocate one receipt across two invoices, cancel one target, and reconcile
   cash, outstanding, remaining credit, party statement, and trial balance. Repeat
   at the lock boundary. Reverse an older posting after rule/master changes and
   require an exact offset of its original lines.
3. Attempt a register-affecting receipt without tax lines inside a tax lock.
   Require the agreed lock behavior.
4. Run Link selection → inline create → return → post-and-next with the keyboard.
   Exercise Esc while a field has focus, master overflow, and a five-line Invoice
   at desktop/mobile widths in both themes. Then run the actual ten-transaction
   H4 protocol with the same operator in Accly and Tally.
5. Have the pilot CA reconcile one imported opening position and one month of
   exports without rework. Record acceptance rather than infer it from familiar
   report names.

These checks follow the existing [core acceptance](../specs/accounting-core.md#task-plan)
and [client acceptance](../specs/client-patterns.md#task-plan). They are proposed
verification, not work performed by this investigation. The next step is a
focused spec revision, then the Receipt proof slice. External market validation
remains a separate activity.

## Sources

Primary source links are attached to each finding above. UI observations name
their visited page or native surface. Local line links refer to the inspected
working tree; later edits can move them. Research was saved under the existing
docs/research convention. Existing workspace changes were preserved.

- [Frappe Books repository](https://github.com/frappe/books)
- [SFab Starter repository](https://github.com/sfab-oss/sfab-starter)
- [Midday apps](https://github.com/midday-ai/midday/tree/main/apps/)
- [Zoho Books demo](https://www.zoho.com/us/books/accounting-software-demo/#/home/dashboard)
- [Accounting core spec](../specs/accounting-core.md)
- [Client patterns spec](../specs/client-patterns.md)
