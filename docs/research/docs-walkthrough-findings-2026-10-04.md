# Findings from the user-guide walkthrough (2026-10-04)

Six agents rebuilt the end-user guide (`apps/docs`) by running every workflow in the
local app (Cedar Components, Ridgeview Academy at 100,000 receipts) and recorded 95
findings. This file merges duplicates into 17 major findings, then minor and polish
items grouped by area. Code references
are from commit `3dab8c8`. Raw notes and evidence screenshots were session scratch and
are not kept; each entry names the code that owns it and how to reproduce it. This file
is evidence: the [work registry](../README.md#work-lifecycle) owns status, and each fix
updates the owning spec or page. Design choices are settled in
[accounting-core Decisions D1–D16](../specs/accounting-core.md#decisions-2026-10-04).

What passed: role permissions match `access.ts` on the sidebar, settings, record
actions and direct API calls; Cedar Components reconciles (trial balance, balance
sheet difference 0, P&L net equals the current-year row, every party statement equals
its control-account line, Banking equals each money-account ledger); balanced-entry and
account refusal rules; party-journal settlement; lock checks on post paths; exception
expiry and revoke; the import posts a cutover that ties to the agreed trial balance.

## Major

| #   | Finding                                                                                                                                                                                                                                                                     | Area                    | Owner and cause                                                                                            | Suggested fix                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Cancelling a document posts its reversal dated today, so the original month's GST and TDS ledgers no longer match their registers (which drop the cancelled document), and the tax lock never applies: a June invoice cancels or amends in October through a June tax lock. | Sales, purchases, locks | `core/locks.ts:24` compares the reversal's `entryDate`; reversals take today                               | Refuse cancel and amend when the original date is in a locked tax period, and decide (CA) whether reversals take the original date                             |
| M2  | Applying or reversing credit is always dated today, with no date field, so earlier months show the receivable and the advance both open.                                                                                                                                    | Sales, purchases        | allocation write path                                                                                      | Date the allocation (default: later of the two documents), check it against locks                                                                              |
| M3  | Documents can be dated before the Opening Balance date, so their amounts count twice (Cedar's bank shows ₹50,590 Cr before its 5 Jul cutover).                                                                                                                              | Setup, accounting       | no cutover check on post                                                                                   | Refuse a posting dated before a posted Opening Balance                                                                                                         |
| M4  | A GST-registered business cannot record its GST payment or input-tax set-off: journals refuse GST accounts and payments cannot name a system account.                                                                                                                       | Accounting              | spec deferral ("GST and advance-account balances", reclass gate)                                           | Owner decision; a GST settlement document or an allowed journal path before the first return                                                                   |
| M5  | The same supplier invoice number can post twice for one supplier, doubling expense, ITC and TDS. Receipts have the same gap (F: same party, amount, reference, date).                                                                                                       | Purchases, sales        | bill post                                                                                                  | Refuse (bills) or warn (receipts) on a duplicate                                                                                                               |
| M6  | **Pay** on a bill and **Refund** on a credit note open the payment form with the party blank and the kind on **Advance**, so a user can post an advance instead of settling.                                                                                                | Purchases, sales        | `party-link-field.tsx:141` reads `getValues("partyName")` during render, so the late name never re-renders | Watch the field (`useWatch`) and preset the settlement kind                                                                                                    |
| M7  | A supplier refund of an unapplied debit note cannot be recorded (no Refund action, receipts cannot settle a supplier, journals refuse payables).                                                                                                                            | Purchases               | settlement kinds                                                                                           | Add a supplier-refund receipt path                                                                                                                             |
| M8  | A debit note against a bill with TDS can credit the gross amount while the TDS stays booked (found in code, not posted).                                                                                                                                                    | Purchases               | note post                                                                                                  | Limit the note to the net or reverse TDS proportionally; CA to confirm                                                                                         |
| M9  | The invoice PDF heading is always "INVOICE"; GST requires "Tax Invoice" or "Bill of Supply". Credit notes have no PDF at all.                                                                                                                                               | Sales                   | invoice PDF; no note PDF route                                                                             | Title by supply type; add a credit/debit note PDF                                                                                                              |
| M10 | Ridgeview's Receipts register takes 8–15 s and once failed with a statement timeout (HTTP 500); Cedar answers in about 50 ms.                                                                                                                                               | Performance             | `routers/receipt.ts:336-353` orders by `id` under a period filter                                          | `EXPLAIN ANALYZE` at volume; order and index on `(org_id, type, document_date, id)`                                                                            |
| M11 | Banking and Home count post-dated documents; the balance sheet and ledgers stop at their date, so the bank differs between them. Future dates post with no warning.                                                                                                         | Reports, banking        | `account.ts:192-217` `moneyBalances` and party `balances` have no date bound                               | Bound by today's business date, and warn on a future date                                                                                                      |
| M12 | Cash can go negative with no warning (Cedar Cash in Hand reached −₹2,650).                                                                                                                                                                                                  | Banking                 | no balance check                                                                                           | Warn when a running cash balance would fall below zero                                                                                                         |
| M13 | The trust/society chart seeds a taxable "Fees" account, and a supply class can never change. School fees are exempt.                                                                                                                                                        | Setup                   | chart template                                                                                             | Make it exempt and allow a class change while unused                                                                                                           |
| M14 | An account created from an invitation sees "Email verification required to view or list invitations" when it opens `/join` again (closed tab, or **Join organization** in the switcher).                                                                                    | Getting started         | join page invitation list                                                                                  | Keep the verification gate (invitation ids are sign-up proof); show the invitee a link back to their own invitation, or let the owner re-share it from Members |
| M15 | On a 390 px phone the invite form's role buttons overflow, so **Operator** cannot be chosen.                                                                                                                                                                                | Administration          | members invite form                                                                                        | Wrap or use a select                                                                                                                                           |
| M16 | No password reset exists, yet the sign-in page says "Ask your administrator to reset your password".                                                                                                                                                                        | Getting started         | sign-in copy                                                                                               | Add an owner/operator reset path or change the copy                                                                                                            |
| M17 | Joining (accepting an invitation) is not audited; member and credit audit entries show only internal ids, so a removed member cannot be identified.                                                                                                                         | Administration          | audit writes                                                                                               | Audit the join; store names and document numbers in `meta`                                                                                                     |

## Minor

**Accounting and data integrity**

- Backdated documents take the next number, so numbers are not in date order (INV26-27/5 dated 12 Jun follows INV26-27/4 of 28 Sep).
- Lock dates can be set in the future; there is no lock history page; exceptions open every locked date, can overlap, have no maximum expiry and can go to members who cannot post.
- A party or account with an open balance can be marked inactive, then cannot settle that balance; opening items already refuse an inactive party.
- Two document types can share a prefix, giving duplicate GST document numbers.
- The GSTIN check digit is not validated (Cedar's seeded GSTIN fails it).
- Payment method names are unique only by exact case ("upi" beside "UPI").
- New account codes ignore the parent group (a fixed asset got 1541 after Cess Input Credit 1540); account groups cannot be created.
- Customer TDS records an amount without a section; the TDS picker does not find "194J" (the new code is 1027) and the bill form never shows the rate; deducting TDS on an advance and again on the bill gives no warning.
- The credit and debit note forms and their **Full** button ignore earlier notes on the same line, so the server refuses the note.
- A cancelled receipt from last month stays in last month's bank balance (follows from M1).
- Direct receipts with a party do not appear in that party's ledger or statement, so a school cannot give a parent a fee statement.
- One bad opening-item cell in an import also raises a false receivables mismatch.
- Journals cannot take party lines on payables (by design); the workaround needs documenting.
- GST 12% is still offered after the 2025 rationalization, and 3% and 0.25% are missing (CA to confirm).

**Forms and records**

- No GST, total or TDS preview on the bill and debit-note forms before saving; the TDS advance form does not show the net paid.
- The refund payment form keeps "Allocate to at least one document" after **Fill**.
- **Discard draft** deletes without confirmation; when two people edit one draft, the second loses unsaved changes.
- Role changes (including to Owner) save on one click with no confirmation.
- Re-inviting a pending email shows "Could not create the invitation"; the only owner leaving shows "Could not update the roster" (auth-library errors become generic server errors).
- The party duplicate-name warning appears below the fold, so **Create party** seems to do nothing.
- A debit note has no field for the supplier's credit-note number.
- The receipt PDF does not list the invoices it settled or the TDS.
- On a phone the journal record hides its number and date, and the allocations table cuts off **Reverse**.
- ITC and IGST columns are cut off in the bill and note record panels.

**Reports**

- The Open and Overdue invoice filters show the total, not the amount due.
- Account-ledger lines do not name the contra account; allocation lines read only "Allocation" with no link.
- The cancellation reason shows only in the audit log; reversal narrations replace it (`report.ts:199-207`).
- No day-close totals by payment method; registers have no totals.
- An oversized day-book XLSX reads 1,00,001 lines before refusing (12 s; `report.ts:283-292`); an oversized PDF opens a tab with a plain-text error (`lib/pdf-response.ts`).
- The party ledger shows a TDS bill net of TDS with no TDS line; the TDS register's "Net" is taxable value minus TDS.

**Administration**

- The audit log has no filters or search; file uploads are not audited and Files does not show the uploader.
- Files cannot be attached to an invoice, bill, receipt or party.
- Pages a role cannot open redirect to Home with no message.

## Polish

- Report screens CSS-capitalize account names ("Cash In Hand", "Furniture And Fixtures").
- Place of supply shows as a bare state code; an empty one says "Use a valid Indian state code".
- XLSX exports show internal codes (`debitNote`, `reverse`), ISO date ranges and `---` in file names.
- Trial balance, account ledger and day book screens lack the report header and "Period not closed".
- The Reports hub omits party statements; the balance-sheet date has no presets.
- "PDF" on the invoice record versus "Print" on the receipt record; page title "Notes" for debit notes; the ⌘↵ hint shows on phones; some amount fields cut off values.
- The Locks page title truncates to "Lo…" at 1280 px; a receivables line's Remove button sits under the open-invoices grid.
- The Join page says "Invited as ca"; the invitation page omits the role; expired invitations vanish without notice; a failed invite leaves the previous link visible; the Join page and switcher order organizations differently.
- The audit table's columns overlap at 1280 px and show raw keys and an unlabeled `import.commit`.
- The command palette lacks "New journal"; "Fiscal year" should read "financial year"; a taxable item saves without HSN; the supply class is hidden in the desktop chart; "Top level" hides the chosen type; a bank account cannot be renamed from Banking; the import template and sample disagree on the Read me A1 label and do not explain tax codes.

## Docs follow-ups

- Screenshots are full 1280 × 800 captures at 1×, shown at about half width, so small text needs the zoom. Recapture at 2× or crop to the active panel.
- Pages that describe M1–M3, M6, M7 and the note **Full** issue state the current limit and a workaround; update them when each is fixed.
- Set `deployment.site` once the docs host is known, for Open Graph images and the sitemap.
