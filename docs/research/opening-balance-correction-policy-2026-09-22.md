# Opening Balance correction policy — 2026-09-22

## Question

How do ERPNext and Zoho Books correct an erroneous Opening Balance, and what should that imply for PR #4's proposed replacement-date guard?

## Answer

**Owner-approved policy:** correct an Opening Balance at its original cutover. In our append-only ledger, cancel it with an opposite entry dated at that cutover, check that date against the existing period lock, and allow a corrected replacement at the same cutover. Keep ordinary document cancellation forward-dated. The candidate replacement-after-reversal-date guard is removed rather than combining two correction policies.

The references support traceable correction of opening data, subject to controls. They do **not** establish the rejected rule that correcting an opening balance must move its cutover to the cancellation date. Our policy adapts their workflows to our ledger; it is not a claim that either vendor uses our implementation.

## ERPNext

The current [Opening Balance guide](https://docs.frappe.io/erpnext/opening-balance), marked updated 14 August 2026, defines opening balances at the migration cutover. Its correction section explicitly says: “If the period is still open, cancel and amend the incorrect opening document or post an approved correcting opening entry.” It requires correction references in the migration log and forbids editing submitted ledger rows.

The current [Immutable Ledger guide](https://docs.frappe.io/erpnext/immutable-ledger-in-erpnext), also marked updated 14 August 2026, says original and opposite cancellation rows remain available for audit. Normal General Ledger reports exclude cancelled rows unless **Show Cancelled Entries** is enabled. It does not say every cancellation must be dated today. For closed periods it directs the accountant to choose controlled reopening, a current-period adjustment, or another supported correction.

The [v15.121.3 cancellation implementation](https://github.com/frappe/erpnext/blob/v15.121.3/erpnext/accounts/general_ledger.py), `make_reverse_gl_entries`, makes an additional configuration distinction:

| `enable_immutable_ledger` | Reversal date                                                       | Cancellation flags                                                    |
| ------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Off                       | Original posting date unless an explicit `posting_date` is supplied | Original rows and opposite rows are marked cancelled.                 |
| On                        | Explicit argument, request posting date, or today                   | Original rows remain uncancelled; opposite rows are also uncancelled. |

The selected date is passed to the freeze check. However, [Accounting Period validation](https://github.com/frappe/erpnext/blob/v15.121.3/erpnext/accounts/general_ledger.py#L130-L164) checks the original GL posting date before that selection. The [opening-specific Period Closing Voucher check](https://github.com/frappe/erpnext/blob/v15.121.3/erpnext/accounts/general_ledger.py#L779-L807) also prohibits an Opening Entry once any submitted PCV exists for the company. A freeze-date comparison alone is not the whole cancellation policy.

Consequently, “immutable ledger” does not by itself mean “all corrections become effective today.” Nor does matching ERPNext's reversal date establish identical historical report behavior: its cancellation flags differ from our entry-date-only balance calculation. Its [General Ledger](https://github.com/frappe/erpnext/blob/v15.121.3/erpnext/accounts/report/general_ledger/general_ledger.py#L270-L320) and [Trial Balance](https://github.com/frappe/erpnext/blob/v15.121.3/erpnext/accounts/report/trial_balance/trial_balance.py#L225-L248) also give `is_opening` rows special date-filter treatment. The reviewed correction guide does not require advancing an amended opening's cutover to its cancellation date.

## Zoho Books

Zoho explicitly documents correcting an incorrect balance through **Settings → Opening Balances → Edit → Continue → Confirm** ([editing FAQ](https://www.zoho.com/in/books/kb/opening-balance/edit-op.html)). This is an opening-balance edit workflow, not a requirement to cancel the opening and create a new migration date.

The [overwrite FAQ](https://www.zoho.com/in/books/kb/opening-balance/overwrite-ob.html) says Zoho automatically passes the required journal entries. Its example changes an account from INR 1,000 to INR 2,500 at a newly selected opening date and automatically posts the INR 1,500 difference. **That example changes the date:** it does not prove the internal entry date of every amount-only correction.

The [migration guide](https://www.zoho.com/in/books/help/migration/migrating-to-zoho-books-from-other-software.html) treats the migration date as the date of the old system's Trial Balance and permits subsequent opening-balance edits. [INFERENCE] Preserving that cutover for an amount-only correction is consistent with these separate amount/date workflows; it is not an explicit guarantee about Zoho's private ledger implementation.

Relevant restrictions:

- [Changing the migration date](https://www.zoho.com/in/books/kb/opening-balance/change-migration-date-on-opening-balances-page.html) has separate customer/vendor opening-balance and opening-stock prerequisites. Do not silently change it merely because a correction happens later. The overwrite FAQ describes a separate, more detailed reset procedure; these pages are not one universal date-change recipe.
- Reconciled bank opening balances cannot be updated until reconciliation is undone or deleted; the user then corrects and reconciles again ([reconciliation error FAQ](https://www.zoho.com/in/books/kb/opening-balance/error-modifying-opening-balance-for-reconciled-transactions.html)). This is a documented dependency, not permission to silently remove reconciliation.
- The [transaction-lock help](https://www.zoho.com/us/books/help/accountant/transaction-lock.html) and [API overview](https://www.zoho.com/books/api/v3/transaction-locking/) do not explicitly settle whether opening-balance edits are covered by transaction locks. Absence from the module list is not proof of a bypass. The UI help says “before” the lock date, while the API overview says “on or before”; we must not treat them as one proven boundary.

The [Opening Balance API](https://www.zoho.com/books/api/v3/opening-balance/) exposes an update resource and a date field, but does not establish whether corrections mutate existing ledger rows, reverse/repost, or use another storage design. We did not exercise a Zoho organization.

## Consequence for our ledger

Before this decision, `reverseDocument` dated every cancellation at the organization's current business date. Historical balances include journal lines by entry date, rather than excluding cancelled source documents. The rejected candidate guard prevented the replacement from being dated before the latest reversal.

Illustration with no other transactions: a 1 April opening of 100 should have been 150, and the error is discovered on 15 June.

| Treatment                                        | Balance on 30 April | Balance after 15 June |
| ------------------------------------------------ | ------------------: | --------------------: |
| Cancel on 15 June; replacement 150 dated 1 April |                 250 |                   150 |
| Candidate guard: cancel and replace on 15 June   |                 100 |                   150 |
| Reverse and replace at original 1 April cutover  |                 150 |                   150 |

These are arithmetic consequences of our dated entries, not observed vendor behavior. The first doubles the old and corrected opening before reversal. The second prevents that double count but preserves the known historical error. Only the third is a historical opening correction.

For the approved policy:

- Preserve original posting and reversal rows and the real cancellation timestamp; do not rewrite ledger history in place.
- Validate the original cutover when cancelling. A locked date requires the existing authorized exception or an explicit reopening. Validate the replacement date normally as well.
- Retain the one-posted-opening invariant and existing organization scope.
- If the period must remain closed, leave the original opening posted and use an accountant-approved current-period Journal adjustment. Do not first cancel it and imply that a lone backdated Journal repairs the entire timeline.
- Do not add Zoho-style edit APIs, inventory resets, reconciliation machinery, or multiple ERPNext-style opening documents to this PR.

## Decision and evidence limits

The owner selected **Correct original cutover**. `reverseDocument` derives an Opening Balance reversal date from the scoped persisted document; other types retain the current business date. The integration lifecycle in `tests/integration/opening-balance.test.ts` covers locked-cutover refusal and rollback, an authorized exception, and a same-cutover replacement that changes historical balances.

Evidence is first-party documentation inspected on 22 September 2026 plus ERPNext source pinned to v15.121.3. Current documentation and a pinned release are distinguished above. Zoho sources are current IN-EN/US-EN help and API v3 pages without a public product revision. Neither vendor was run, and no claim is made about all report variants or private Zoho ledger storage.

This narrows the earlier [opening-and-locks research](./opening-balance-and-locks-2026-09-20.md): its cancellation-date comparison did not establish an opening-replacement correction policy. The [accounting contract](../specs/accounting-core.md#journal-opening-balance-and-locks-slice-5) owns the current rule.
