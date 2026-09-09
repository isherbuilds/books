# Validation: CA-first cloud ledger for Indian B2B SMBs

Date: 2026-09-08
Status: framed

Research behind this packet: [market-entry-research.md](./market-entry-research.md) (section 0 carries the reviewed verdict). Field experiment: [ca-interviews.md](./ca-interviews.md).

## Bet

For a **CA-managed B2B business of 2 to 50 crore turnover** (in-house accountant enters daily, CA firm files and reviews) doing **monthly books, GST returns and TDS**, replacing **TallyPrime on a LAN plus Tally backups, WhatsApp and Excel exchanged with the CA** with **one cloud ledger the accountant and the CA firm share, with an append-only journal, auto-lock on filed returns, a CA-firm console across clients, Tally-parity keyboard speed and a read-only agent over the books** will **cut month-end close and CA query turnaround** enough to justify **migrating the books off Tally and paying at least Zoho Books Standard price (899 rupees a month per entity)**.

Two actor pairs share this bet and are validated together only because the CA is the referrer and the business is the payer. If interviews show CAs want a CA-only tool that exports to the client's Tally, this splits into two bets and returns to `brainstorm`.

## Verdict

Internal utility: **not applicable** unless a captive organization exists for a pilot. The product docs mention a pilot runbook; if a friendly business and its CA are reachable, that is rung 3 to 6 access, not market proof.

External business: **insufficient evidence**. The research (rung 1, source-backed) shows the compliance layer is commoditized by TallyPrime 6.1, Zoho Books India and Busy, and shows no behaviour evidence for the shared-workspace premise. The one experiment that resolves this is the interview and observation set in [ca-interviews.md](./ca-interviews.md): five CA firms, one observed month-end per firm, one commitment ask each.

Confidence: **low**.

Why now: IMS (Oct 2024) and the falling 30-day IRN cap make buyer-side action a monthly chore; Companies Act edit-log rules make ledger integrity a compliance argument; Vyapar buying Suvit shows incumbents merging billing and CA layers.

Strongest counter-evidence: TallyPrime 6.1 Connected GST and Zoho Books India already ship books plus filing in one product; Zoho gives CAs three years free and a partner store; Tally has thousands of partners the CAs already use. The "one CA brings 20 to 50 clients" figure is unsourced.

Largest untested risk: CAs do not want a live shared workspace with clients, or want it but will not move client books off Tally. Second: the in-house accountant refuses anything slower than Tally keystrokes.

Next smallest proof: five CA interviews with an observed month-end and a scheduled sanitized-data trial ask. Kill if fewer than two firms schedule a trial.

## Baselines

Scenario: a distributor with 12 crore turnover, 180 sales invoices and 90 purchase bills a month, one in-house accountant, CA firm files GSTR-1, GSTR-3B and quarterly TDS. Exception: a supplier credit note arrives after GSTR-3B is filed and a purchase bill was booked at the wrong GST rate.

| Step                     | Today (Tally on LAN + CA over WhatsApp)                                                                                  | Strongest alternative (Zoho Books India Professional, CA on partner store)                           | Proposal                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Setup                    | Already installed; TSS renewal; CA receives backup file monthly                                                          | Tally import wizard; chart of accounts mapping; e-invoice and GSP setup; CA added as accountant user | Tally XML import; CA firm invited across entities; GSP as ASP; lock policy set            |
| Ordinary path            | Accountant enters in Tally; IRN via Connected GST; 2B download and IMS inside Tally 6.1                                  | Same inside Zoho; IRN native; 2B and IMS native; direct filing                                       | Same set; must match keystroke speed; IMS queue and 2B match on the document              |
| Exception                | Back-dated edit blocked by cut-off date if set; often not set; accountant edits the voucher, CA finds mismatch at filing | Transaction lock if enabled; otherwise edit in place                                                 | Edit refused after lock; reversal entry forced in open period; both parties see the trail |
| Handoff                  | Backup to CA over WhatsApp or Drive; CA restores locally; queries back by call                                           | CA logs in; comments not native; queries by email                                                    | Same live data; query on the document; firm console shows pending items                   |
| Recovery                 | Restore from backup; duplicates common                                                                                   | Cloud; audit log per transaction                                                                     | Append-only journal; nothing to restore                                                   |
| Reporting and obligation | GSTR-1/3B filed from Tally 6.1 or portal; TDS via separate utility                                                       | Filed from Zoho; TDS module partial                                                                  | Filed from ledger; TDS deduction and 26Q export in scope                                  |
| Migration and exit       | Data is local; Tally XML export                                                                                          | Export to CSV; Tally XML export exists                                                               | Must export Tally XML and CSV, or exit cost blocks adoption                               |

Evidence status: every row is **inferred** from product pages (rung 1) until observed. The unhappy path has not been walked in any product.

## Hypotheses and gates (thresholds provisional until accepted)

| #                   | Hypothesis                                    | Evidence needed                      | Experiment                                                                      | Metric                                            | Pass / kill                                                        | Result  |
| ------------------- | --------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| H1 Problem          | CA-client exchange costs real time each month | Observed workflow (rung 4)           | Sit with the accountant or CA at one month-end; time the handoff and query loop | Hours of waiting plus rework per client per month | Pass at 4 hours or more; kill under 1 hour                         | pending |
| H2 Shared workspace | CAs want live shared books, not exports       | Commitment (rung 5)                  | Interview then ask to schedule a trial with one client's sanitized data         | Firms that schedule                               | Pass at 3 of 5; kill at 0 to 1                                     | pending |
| H3 Switching        | Tally migration is reliable and short         | Artifact and rehearsal (rung 3 to 4) | Import a real Tally XML sample in scratch space; compare trial balance          | Rupee mismatch, elapsed effort                    | Pass at zero unexplained mismatch under 2 hours; kill over one day | pending |
| H4 Speed            | Keyboard entry matches Tally                  | Observed timing (rung 4)             | Time a 5-line invoice in Tally, then in a throwaway prototype                   | Seconds and keystrokes                            | Pass within 10 percent of Tally; kill over 25 percent slower       | pending |
| H5 Trust            | Auto-lock and reversal handle the exception   | Simulated exception (rung 4)         | Walk the late credit note through the prototype with the CA watching            | CA accepts the trail; filed return unchanged      | Pass on acceptance; kill if the CA wants in-place edits            | pending |
| H6 Economics        | Business pays at or above Zoho Standard       | Priced proposal (rung 5 to 7)        | Send a priced proposal after trial                                              | Signed commitments                                | Pass at 2 or more; kill at 0                                       | pending |
| H7 Distribution     | A CA firm is a working channel                | Channel test (rung 5)                | One firm introduces clients within 30 days                                      | Qualified client conversations                    | Pass at 3 or more; kill at 0                                       | pending |

Hard gates that cannot be averaged: H3 (migration loss), H5 (trust), H6 (economics). Any kill on these ends or reframes the bet.

## Experienced workflow

To be filled from observation. Setup, ordinary path, exception and correction, approval and handoff, recovery, reporting and obligation, support and migration and exit, each with elapsed time, steps, errors, assistance, confidence, money.

## Evidence ledger

| Claim                                                                                    | Label         | Evidence                                       | Bias or counter-evidence                                  |
| ---------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------- | --------------------------------------------------------- |
| TallyPrime 6.1 does 2B, IMS, IRN, EWB and direct filing inside Tally                     | source-backed | Tally help pages, research [27]                | Requires current release and TSS; many installs are older |
| Zoho Books India ships the same set in the cloud, INR 899 to 9,999 a month, CA programme | source-backed | Zoho pages, research [28][29]                  | Reported complaints on rigidity and support; not observed |
| Busy ships TDS, 43B(h), inventory for the same segment                                   | source-backed | Busy pages, research [30]                      | Desktop; not observed                                     |
| India accounting software market about USD 640M in 2024                                  | source-backed | IMARC [4]                                      | Excludes compliance SaaS spend                            |
| Tally is dominant with 2 to 3M paid users                                                | reported      | Reseller and trade press [1][14]               | Share figures unsourced                                   |
| CA firms lose 60 to 90 hours a month on 2B reconciliation                                | reported      | Vendor blog [6]                                | Vendor sells the fix                                      |
| One CA brings 20 to 50 clients                                                           | inferred      | No source                                      | Must come from interviews                                 |
| Businesses will leave Tally if the CA asks                                               | inferred      | No source                                      | Zoho and Tally partner programmes compete for the same CA |
| Ledger integrity is a buying reason                                                      | inferred      | Companies Act edit-log rule (not web-verified) | May be a compliance checkbox, not a felt pain             |

## Economics and distribution

Price anchor: Zoho Books Standard 899 rupees a month with e-invoicing at 749 on annual billing; Tally TSS about 375 a month equivalent on a perpetual licence. A per-entity price above 899 needs a visible reason. CA firm console is the candidate for a firm-level fee.

Delivery cost unknowns: GSP per-call pricing, AA provider fees, WhatsApp API, support hours during Tally migration. Channel: CA firms, untested. Zoho offers CAs three years free, so the offer must be explicit (free firm workspace, revenue share or migration done for them).

## Decision boundary

Moves to **pilot**: H2 passes and H3 passes on a real sample.
Moves to **reframe**: H2 fails but H1 passes (CAs want a CA-only tool; the bet becomes a CA console that reads Tally, not a ledger).
Moves to **use/integrate or stop**: H1 fails, or H5 fails, or two of H3, H6, H7 kill.
