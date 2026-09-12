# Glossary

Canonical terms for Accly Books. Use them exactly in code, navigation and docs. Owner: `docs/specs/accounting-core.md`.

- **Organization**: one legal entity with one PAN; never "business", "workspace" or "company file".
- **Member**: a User's membership and union of roles in one Organization. Roles: owner, accountant, ca, operator.
- **Party**: any counterparty: customer, vendor, tenant, donor, employee, government. Replaces Customer and Payer.
- **Payment Method**: a named way money moves, bound to one cash or bank Account.
- **Account**: a node in the chart of accounts.
- **Item**: a thing sold or bought, with HSN or SAC and a tax class.
- **Document**: the write model. Receipt (money in), Payment (money out), Invoice (sale), Bill (purchase), Credit Note, Debit Note, Journal (manual), Opening Balance. States: draft, posted, cancelled.
- **Journal Entry / Journal Line**: the derived, append-only ledger. A reverse entry cancels a post entry; nothing is edited.
- **Party Ledger Line / Allocation**: receivable or payable exposure per document and the append-only matching of documents.
- **Balance**: cumulative debit and credit per Organization, Account and month.
- **Exposure Side**: `receivable` or `payable`, the control a Document settles against; independent of cash direction, so a customer refund stays on the receivable side.
- **Posting function**: code, one per Document type, that builds the journal legs from the Payment Method, the line Account and `Account.systemKey` (ADR 0002).
- **Tax Rate Row / TDS Section Row**: dated data that decides rates; never code.
- **Number Series**: per Organization, document type and financial year.
- **Period Lock / Lock Exception**: a date through which posting is refused, and a named, time-boxed, audited exemption.
- **Billing**: the layer that issues, settles and corrects Documents and knows who owes what: Party, Item, Payment Method, Document, Number Series, Party Ledger Line, Allocation.
- **General Accounting**: the layer that posts Documents to the ledger and reports on it: Account, the posting functions, Journal Entry and Line, Balance, Period Lock. An Operations system (hospital, school, point of sale) sits above Billing and never touches General Accounting.
- **Source / External Reference**: who created a Document (a user or a named system) and that system's own id.
