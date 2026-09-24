# Journal architecture provenance

Date: 2026-09-20

## Question

Which accounting products influenced the staged manual-journal architecture,
what did Accly adopt, and what did it reject?

## Answer

The staged journal is not a port of ERPNext, Frappe Books, Odoo, Zoho Books, or
TallyPrime. It implements a small common core: balanced debit and credit lines,
a document or voucher as the source, a derived general-ledger entry, and a
reversal for correction. Accly then applies its existing tenant, permission,
numbering, posting, audit, and UI patterns. The staged diff adds no competitor
code and no dependency from those products.

The closest reference is ERPNext's Journal Entry workflow. Both systems accept
several account rows, require equal debit and credit totals, use non-group
accounts, and recommend a specialized payment or invoice flow for routine
transactions. Accly deliberately implements less: no draft, approval,
multi-currency, dimensions, templates, recurring journals, control-account
settlement, or tax posting. [ERPNext Journal Entry](https://docs.frappe.io/erpnext/journal-entry)

The correction model is closest to ERPNext immutable-ledger mode and Odoo's
reversal workflow. Accly stores a separate reversing entry and never edits the
posted journal lines. [ERPNext general ledger source](https://github.com/frappe/erpnext/blob/df8b7f9648c2ec4da12db8c4022edc8dd1018c6b/erpnext/accounts/general_ledger.py#L679-L778),
[Odoo reversal source](https://github.com/odoo/odoo/blob/19.0/addons/account/wizard/account_move_reversal.py)

## Evidence

### What the staged implementation does

- `packages/api/src/routers/journal.ts:40` (`postInput`) validates 2–100 positive
  lines and equal debit and credit totals before any write.
- `packages/api/src/routers/journal.ts:67` requires the `journal.post` grant and
  resolves every account and optional party inside the verified Organization.
- `packages/api/src/routers/journal.ts:81` posts in one database transaction.
  It locks Organization settings for share, validates account eligibility, then
  calls the existing `postDocument` path.
- `packages/api/src/core/posting.ts` maps explicit Journal sides to ledger
  debit and credit columns. The shared balance assertion remains the final
  invariant before insertion.
- `packages/db/src/schema/document-lines.ts` adds nullable `entrySide` and
  `partyId` to the existing document-line model. Existing Invoice, Receipt, and
  Payment lines keep both fields null.
- `apps/web/src/components/journal-form.tsx` supplies one Debit line and one
  Credit line by default, shows live totals and the difference, and posts the
  full voucher without a draft.
- `tests/integration/journal.test.ts` covers posting, listing, balances,
  cancellation, role denial, invalid control accounts, foreign parties, and the
  registered-Organization tax guard.
- `tests/integration/tenancy.test.ts` proves that journal reads, cancellation,
  account ids, and party ids cannot cross Organization boundaries.

### What came from the reference systems

| Reference    | Pattern used                                                                                                                                | Pattern not used                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ERPNext      | Balanced multi-line Journal Entry; non-group accounts; source-document posting; reversal; specialized flows preferred for ordinary payments | Control-account settlement, reference allocation, multi-currency, dimensions, templates, many entry types |
| Frappe Books | Simple Journal Entry form and ledger posting after submit                                                                                   | Desktop-only SQLite architecture, ledger-row deletion, single-tenant model                                |
| Odoo         | Document state plus derived journal lines; posted-entry reversal                                                                            | One broad `account.move` model for every accounting document, ORM-level mutation paths, report DSL        |
| Zoho Books   | Organization-scoped journal API and action-shaped transitions                                                                               | Draft/publish/approval workflow, recurring journals, journal credits applied to invoices and bills        |
| TallyPrime   | Voucher speed and the debit/credit mental model                                                                                             | Editable voucher history as the primary correction path and a local proprietary company file              |

Sources: [Frappe Books Journal Entries](https://docs.frappe.io/books/journal-entries),
[Odoo journal-entry model](https://github.com/odoo/odoo/blob/19.0/addons/account/models/account_move.py),
[Zoho Books Journals API](https://www.zoho.com/books/api/v3/journals/),
[TallyPrime Edit Log](https://help.tallysolutions.com/tracking-modifications/).

### Why this narrower architecture won

The repository already makes Documents the only write model and treats the
ledger as a derived, append-only result (`docs/architecture.md:140`). Reusing
`postDocument`, `recordEntry`, `reverseDocument`, number series, and
`orgProcedure` keeps one write path and one authorization model. A separate
voucher engine would duplicate transaction, numbering, cancellation, audit,
and tenancy rules.

Blocking party-control and GST accounts is a product boundary, not a technical
limitation. The current Journal cannot name invoice references or tax facts, so
allowing those accounts would create ledger balances that the party and tax
subledgers cannot explain. ERPNext documents why party references affect
outstanding balances; Accly defers that linked workflow instead of accepting an
unreconciled shortcut. [ERPNext journal references](https://docs.frappe.io/erpnext/adding-reference-to-journal-entry)

TallyPrime proves the value of fast voucher entry, but its official Edit Log
material also confirms that vouchers can be altered and deleted and that those
actions are tracked as versions. Accly chooses reversal-only posting because a
new offsetting entry is simpler to audit and cannot silently replace the facts
used by prior reports. [TallyPrime Edit Log](https://help.tallysolutions.com/edit-log-for-masters-transactions/)

## What this proves and does not prove

The staged code and cited sources prove the structural similarities above. They
do not prove that a competitor was the first inventor of a pattern, that its
implementation is correct for Indian statutory accounting, or that Accly has
feature parity. Similar double-entry shapes are expected across accounting
systems.

The repository's earlier research, stored at Git commit `a716b6c` as
`docs/research/ledger-architecture.md` and
`docs/research/accounting-contract-decisions-2026-09-10.md`, states that no
product was copied whole and that no reference source was copied into product
code. This investigation confirms that conclusion for the staged Journal diff.

## What this means for us

Keep this first Journal narrow until a CA approves worked examples for bad-debt
write-off, receivable or payable set-off, GST reclassification, and opening
balances. Each approved case can add a specific contract. Do not unlock control
or tax accounts with a generic override.

The main costs of the chosen design are immediate posting, no approval queue,
and less flexibility than incumbent journal modules. The benefits are one
transactional posting spine, explicit tenant predicates, deterministic reversal,
and no second reconciliation model.

## Next falsification

Ask a CA to enter the same five real adjustments in Accly, ERPNext, Zoho Books,
and TallyPrime. Record required fields, keystrokes, correction steps, and the
resulting party, tax, and general-ledger reports. A required pilot transaction
that cannot be represented without a control or tax account falsifies the
current first-Journal boundary and needs a named document workflow before that
account is enabled.

## Sources

- [Accly architecture](../architecture.md#ledger)
- [Accly accounting-core Journal contract](../specs/accounting-core.md#journal-opening-balance-and-locks-slice-5)
- [ERPNext Journal Entry](https://docs.frappe.io/erpnext/journal-entry)
- [ERPNext immutable-ledger implementation](https://github.com/frappe/erpnext/blob/df8b7f9648c2ec4da12db8c4022edc8dd1018c6b/erpnext/accounts/general_ledger.py#L679-L778)
- [Frappe Books Journal Entries](https://docs.frappe.io/books/journal-entries)
- [Odoo journal-entry model](https://github.com/odoo/odoo/blob/19.0/addons/account/models/account_move.py)
- [Odoo reversal workflow](https://github.com/odoo/odoo/blob/19.0/addons/account/wizard/account_move_reversal.py)
- [Zoho Books Journals API](https://www.zoho.com/books/api/v3/journals/)
- [Zoho Books Manual Journals](https://www.zoho.com/in/books/help/accountant/manual-journal.html)
- [TallyPrime Edit Log](https://help.tallysolutions.com/tracking-modifications/)
