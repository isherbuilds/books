# ADR 0002: Posting mechanics in code, account mappings and rates in data

Date: 2026-09-10
Status: accepted. Supersedes one sentence of ADR 0001: "Tax and posting rules are dated data rows that documents reference" now reads "Tax rules are dated data rows that documents reference; posting mechanics are code."

## Context

ADR 0001 planned a Posting Rule table keyed by document type, line kind, tax class and legal type, resolved by priority and effective date, so that account mapping never lived in code. Writing the Receipt scenario against that key showed it cannot express the finite mechanics: an advance Receipt has no item or account line to key on, its debit comes from the Payment Method row, a direct Receipt credits the Account named on its line, and a Payment refunding a customer Credit Note must hit the receivables control although money goes out. Making the key express all of that means adding an amount basis, symbolic targets, precedence and tie rejection: a rules language for eight document types.

ERPNext, Frappe Books and Odoo Community were inspected at pinned commits (see `docs/research/accounting-contract-decisions-2026-09-10.md`). Each builds the bank leg, the party leg, tax and deductions in explicit code and resolves the liquidity account and the receivable or payable control independently. None uses a generic debit/credit rule matrix for that.

## Decision

Each document type has one typed, pure posting function in `packages/api/src/core/posting.ts`. `settlementKind` and `exposureSide` select behaviour inside it. Accounts come from data: the Payment Method's account, the Account named on a line, and `Account.systemKey` mappings seeded per legal type and unique per Organization. Rates come from the dated Tax Rate and TDS Section rows. No account id, account name or GST rate lives in code. `recordEntry` resolves the accounts, calls the document type's function and persists one balanced entry. Reversal reads the stored lines and never runs the function again.

## Consequences

- A new accounting event (reverse charge, a taxable advance, a separate advances account) is reviewed code plus a seed of `systemKey` mappings, not an editable rule row. For a finite document set that is the safer change.
- The Posting Rule table, its priority and effective dates, and the rule row id on document lines are not built. Document lines store only the tax rate row id they used.
- Unit tests cover every `settlementKind` and `exposureSide` branch of each function without a database.
- `docs/research/ledger-architecture.md` section 6 still lists posting rules as data; it is retained as research evidence and this ADR is the decision.
