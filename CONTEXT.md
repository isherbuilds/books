# Glossary

Canonical terms for Accly Books. Use them exactly in code, navigation and docs. Owner: `docs/specs/accounting-core.md`.

- **Organization**: one legal entity with one PAN; never "business", "workspace" or "company file".
- **Site**: an operating location inside an Organization that owns document number series.
- **Member**: a User's membership and union of roles in one Organization. Roles: owner, accountant, ca, operator.
- **Party**: any counterparty: customer, vendor, tenant, donor, employee, government. Replaces Customer and Payer.
- **Account**: a node in the chart of accounts.
- **Item**: a thing sold or bought, with HSN or SAC and a tax class.
- **Document**: the write model. Receipt (money in), Payment (money out), Invoice (sale), Bill (purchase), Credit Note, Debit Note, Journal (manual), Opening Balance. States: draft, posted, cancelled.
- **Journal Entry / Journal Line**: the derived, append-only ledger. A reverse entry cancels a post entry; nothing is edited.
- **Party Ledger Line / Allocation**: receivable or payable exposure per document and the append-only matching of documents.
- **Balance**: cumulative debit and credit per Organization, Account and month.
- **Posting Rule / Tax Rate Row / TDS Section Row**: dated data that decides accounts and tax; never code.
- **Number Series**: per Organization, Site, document type and financial year.
- **Period Lock / Lock Exception**: a date through which posting is refused, and a named, time-boxed, audited exemption.
- **Command**: a named, idempotent mutation with a client-generated id, recorded in the command log.
- **Source / External Reference**: who created a Document (a user or a named system) and that system's own id.
