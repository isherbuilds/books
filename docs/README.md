# Accly Books documentation

Each page owns one area. Keep a fact in one place and link to it. Code is the
authority for exact APIs, schemas and permissions. End-user help lives in
`apps/docs`; terms live in [`CONTEXT.md`](../CONTEXT.md).

| Page                                           | Owns                                 |
| ---------------------------------------------- | ------------------------------------ |
| [Product](./product.md)                        | Position, scope, language, gates     |
| [Architecture](./architecture.md)              | Tenancy, data, audit, files, ledger  |
| [Development](./development.md)                | Setup, commands, code rules, tests   |
| [Operations](./operations.md)                  | Environment, deployment, pilot       |
| [Design](./design.md)                          | The UI source of truth               |
| [Accounting core](./specs/accounting-core.md)  | The accounting contract              |
| [Client patterns](./specs/client-patterns.md)  | Palette, forms, lists, Sheets        |
| [CA interviews](./validation/ca-interviews.md) | The pre-launch CA interview protocol |

## Work lifecycle

The only list of unfinished work. **Active**: work remains. **Blocked**: a named
prerequisite stops it. **Verification**: the code is done; the evidence is not.
Check UI items in the running app on desktop and mobile, in both themes.

- **[User-guide walkthrough findings](./research/docs-walkthrough-findings-2026-10-04.md)**:
  Active. 17 major findings, plus minor and polish items, from running every workflow
  for the rebuilt guide in `apps/docs`. Every design question is decided in
  [Decisions D1–D16](./specs/accounting-core.md#decisions-2026-10-04); what remains
  is building and verifying them. D8 is built and verified: note, invoice and tax tests pass;
  served Credit Note, Debit Note and Tax Invoice PDFs carry the right headings and Rule 53(1A) particulars.
  The note PDF link shows at 1440 and 390 px in both themes.
  A Bill of Supply PDF was not exercised in the app (no such invoice locally); its title is covered by the unit test.
  Start with reversal and allocation dating against locks (D1,
  D2), postings before the cutover (D3), GST journals (D4), duplicate bills (D5)
  and the blank party on Pay/Refund (M6, a bug).

- **Combobox input simplification**: Verification. Invoice party and item picks
  keep one input mounted; Enter selects, Tab reaches the next control, and
  typing over a saved choice clears it. Empty search results render in the
  list. The Apply Credit picker selects a receipt and focuses Amount; editing
  that choice disables Apply credit. Checked on desktop and at 390 px in both
  themes. Against the prior picker on the same local fixture, 24 alternating
  invoice party searches took 18.7 → 13.7 ms median and 31.4 → 30.7 ms p95
  from input event to the second animation frame in Chrome dev mode. The
  LinkField client chunk fell from 16.52 to 14.61 kB gzip; the three picker
  files fell from 755 to 686 lines. Remaining: exercise Load more with a party
  that has over one page of open credits.

- **Client bundle trim**: Verification. Client gzip JS fell 669.1 → 648.2 kB
  (`bun --bun vite build`, sum of `assets/*.js` at gzip -9). Drizzle left the
  client: the account, lock and entry-side lists moved to dependency-free
  `*-kinds.ts` files, as `settlement-kinds.ts` did (−10.5 kB). cmdk's
  never-used Radix `Command.Dialog` no longer drags Radix Dialog, remove-scroll
  and aria-hidden in: `vite.config.ts` aliases it to a throwing stub (−10.4 kB).
  Palette opens, filters and closes on Esc in the dev app with no console
  errors. Remaining: check at 390 px and in dark theme.

- **Apply Credit form cleanup**: Verification. The credit picker now uses the
  Combobox's own open state. Lint and format passed; the web production build
  passed before the concurrent Combobox edit landed.
  Check selection, Load more, and keyboard use at desktop and mobile widths in
  both themes when the concurrent Combobox edit and dependency update restore
  the local web app and type check.

- **[Query performance](./specs/query-performance.md)**: Active. Open: S4's
  party statement refusal timing and S7 close-out. The local database is on
  the current baseline with `db:seed:volume`; run `bun run db:seed:mega` for
  the mega-volume checks.
- **Loading indicators**: Verification. The list, picker, invitation, join,
  allocation and opening-balance wait states use `WaveLoader`; types, lint and
  build pass. Check a loading state at desktop and mobile widths in both themes
  after the local web and API proxy processes respond.
- **Cooler light palette**: Verification. The public page renders at desktop and
  phone widths; the contrast test and production build pass. Check an authenticated
  console page in light and dark after the local migration records match this
  checkout and the web and API services start.
- **[Accounting core](./specs/accounting-core.md)**: Active. Slices 7a–7c
  (opening items, workbook masters, Settings > Import) are implemented on
  `feat/import-tally-opening-items`; `tests/integration/import.test.ts` and
  `request-lifecycle.test.ts` cover their acceptance. In the dev app, Check
  and Import pass for valid and invalid workbooks, a file edited after it was
  chosen toasts "Choose it again", and a numeric State code `7` saves as `07`.
  On Meridian at `db:seed:volume` (production API build, 20 runs), a 1,000-party,
  5,000-item `import.commit` takes p95 1.29 s and `import.check` 107 ms; 5,000
  parties take p95 1.55 s and 132 ms. Bulk inserts of 1,000 rows into
  `documents` and `party_ledger_lines` take most of that time; no single
  statement is slow. Open for slice 7: 7d (TallyPrime XML) is gated on an
  anonymized real Tally export.

  Also
  open: CA acceptance of every implemented slice, and the slice 2 posting p95
  on native PostgreSQL at `db:seed:volume`. Slices 1–6, 8 and 9 are
  implemented; their open runtime checks are listed below. Slice 6 is
  covered by the report, receipt and tenancy integration tests and the
  report unit tests. Its pages (trial balance, P&L, balance sheet, account
  ledger, day book, party Ledger downloads) passed at 1440 and 390 px in both
  themes on Cedar Components: balance sheet → leaf → ledger → voucher, the
  ledger closing equal to the balance sheet row, the P&L net equal to the
  current-year row, and every report PDF answering `application/pdf`. At
  210,124 Meridian journal lines on native Docker PostgreSQL after `VACUUM
ANALYZE`, a production API build returns 365-day RPC p95 of 39.7 ms
  (`trial_balance`), 37.8 ms (`profit_and_loss`) and 39.3 ms
  (`balance_sheet`) over 200 requests each, all below 100 ms.
  Warm `EXPLAIN (ANALYZE, BUFFERS)` shows parallel sequential scans of
  `journal_lines`: 41.2, 30.8 and 30.2 ms respectively, with 11,373
  shared buffers hit and none read for each. Slice 6 regenerated the
  migration baseline to add `journal_lines.entry_date` (rule 4); a database
  still on the earlier `0000_rare_johnny_storm` baseline fails migration and
  must be reset with `bun run db:seed -- --reset`. Slice 9a's
  Journal form, record, Apply credit and party Ledger link passed at 1440
  and 390 px in both themes; open: the Opening Balance picker without
  `receivables`, the Journal Invoice picker after a reversed refund and Fill
  against a party's net credit at desktop and mobile widths in both themes,
  Journal recovery after a selected Invoice closes, and Receipt and Payment
  Fill/totals after the allocation grid refactor,
  and `party.openCredits` with Journal credits under "Settlement reads at
  volume". Slice 9b is covered by the journal
  integration test; open: the Receipt form's Open items grid listing a
  Journal debit, posting against it, and the Receipt Sheet's Journal
  allocation link at 1440 and 390 px in both themes (the local database
  needs a reset to match the migration baseline first), and
  `party.openItems` with Journal debits under "Settlement reads at volume".

- **Virtualized lists and paged ledgers**: Verification. Every `DataTable`, the
  audit and files panels, the account ledger and the day book render through
  `useVirtualRows`; keyset lists load the next 25 rows as they scroll into view.
  At 210,124 Meridian lines on native PostgreSQL, warm
  `EXPLAIN (ANALYZE, BUFFERS)` shows an account summary parallel sequential
  scan in 22.4 ms (11,357 buffers hit, none read) and a first-page index
  scan in 0.4 ms (216 hit). The day-book summary uses parallel sequential
  scans of lines and entries in 51.1 ms (12,207 hit, 5,194 read); its
  first-page index-only entry scan takes 0.1 ms (5 hit), and indexed
  detail takes 0.6 ms (498 hit).
  Party ledger, account ledger and day book page oldest first on
  `(entry_date, id)` with a top summary. On mega-volume Meridian (1.3M journal
  lines) warm page queries take 0.1–3 ms; the summaries scan their period
  (account 165–390 ms, day book 120–770 ms, party 14–80 ms). Checked at 1440
  and 390 px in both themes: SSR first rows, auto-load, bounded mounted rows,
  balances continuing across pages, the Closing row only after the last page, and
  row focus kept when a Sheet closes. In the light theme: on 1440 px Meridian
  Invoices, ArrowDown from row 0 reaches row 60 across the mounted window and
  ArrowUp returns; a cold-loaded day book fills the viewport after scrolling
  at 1440 and 390 px; a failed remote party search shows "Could not load
  parties"; renaming a party shows the new name on a day book cached earlier
  in the session. Open: those four checks in the dark theme; a scroll to the
  list end during a background refetch, confirming no next-page request starts
  until the refetch settles (the code follows TanStack Query's `!isFetching`
  guard); an organization legal-name edit refreshing a cached report header;
  confirm the Parties table and its row highlight fill the bordered box at
  desktop width after the virtual spacer fix, in both themes; the 5,000-party
  register (the local seed has 94 parties); and period roll-ups if summaries
  miss the report budget on native PostgreSQL. Open the Party Ledger and five
  report PDF links in the running app and confirm they open without a Base UI
  native-button console warning.
- **Settlement reads at volume**: Verification. Every read of outstanding or
  unapplied goes through `settlementPaise`: per row, one indexed lookup of the
  document's single `post` party ledger line (a unique index) less its active
  applies. Measured with `EXPLAIN ANALYZE` on `db:seed:volume` (100,000
  Receipts per organization, 44,000 party ledger lines, no Invoices), grouped
  joins before and correlated reads after: a 25-row register page with
  balances 140–150 → 0.3–0.6 ms; the Invoice list and its open filter 48 →
  0.1 ms; `party.openItems` 47 → 0.1 ms; `party.openCredits` for a party
  with 5,799 open advances 85 → 55 ms, which reads every open credit and
  sorts in memory before the 200-row limit. Both pickers now return 25-row
  pages on a `(document date, id)` keyset (#16), but without an index in
  that order the database still reads and sorts every open credit before
  the page. Open: the unfiltered Invoice, Bill and Note register pages, the
  open and overdue filters and both pickers on 100,000 Invoices and Bills
  with allocations; decide then whether the pickers need an
  `(org, party, document date, id)` index. Since slice 9 both pickers also
  admit Journals through `exists` on `party_ledger_lines`, an `OR` arm that
  the party index cannot serve, so its cost grows with the organization's
  Journals. `db:seed:volume` seeds none, so measure with Journals seeded. If
  the arm is slow, drive both pickers from `party_ledger_lines_org_party_idx`
  (every settling document has one `post` line per party; the sign gives
  source or target) instead of adding an index.
- **Mega volume seed**: Verification. `db:seed:mega` fills Meridian Traders,
  Ridgeview Academy and Cedar Components to 1M, 5M and 15M total documents with
  linked document, journal, ledger and allocation rows. Open: run on local
  PostgreSQL, confirm final row counts, then measure register and report reads.
- **[Keyboard focus](./design.md)**: Verification. One global rounded ring
  with `data-focus-inset` for full-bleed rows. Desktop light checks passed for
  the login autofocus, Sign in, settings tabs, sidebar search and a receipt row
  link, and the muted sidebar palette trigger passed in both themes. Remaining:
  mobile widths, dark theme, dialogs, menus, comboboxes and compact data-table
  rows. Cell-level text links sit about 2px from the ring.
- **[Choice controls](./design.md#8-layout-primitives)**: Verification. The
  signed-in desktop pass confirmed organization and account menus in both
  themes, the active organization mark, theme radio selection and Escape
  dismissal. Remaining: filter submenus, date popover and record combobox;
  keyboard focus, edge placement and empty search results; mobile widths in
  both themes. The Mac locked before those checks could finish.
- **[Navigation, Home and Reports](./design.md)**: Verification. The native
  rail, collapsible groups, Home, Reports (then four XLSX downloads; the
  slice 6 index is under Accounting core), palette
  document search and the section-keeping org switcher were checked on
  desktop in both themes and on a 375 px drawer. Remaining: keyboard pass
  through the collapsed groups and the drawer; confirm Home keeps the same row
  height as other links while the rail scrolls at a short viewport height, in
  both themes; and `account.moneyBalances` (Home and Banking) timed at
  `db:seed:volume`. A Party hub is not built.
- **Review fixes**: Verification. Run the journal, invoice, auth integrity and
  settings integration tests when Docker is available. Check the Product menu
  and group-hover links with mouse and touch at desktop and mobile widths, in
  both themes. Confirm a failed Load more request shows one retry control and
  a failed background refresh keeps its rows.
- **Stale allocation recovery**: Verification. In a local two-session fixture,
  select an open Invoice in a Receipt and an open Bill in a Payment, settle each
  from the other session, then refresh the form's open rows. Confirm each form
  shows Clear unavailable, clears the hidden amount and error, and can submit
  a new allocation. Use the seeded Cedar Components organization, which has
  posted Invoices and Bills; the running-app check remains open.
- **Limits rule ([#17](https://github.com/isherbuilds/books/issues/17))**:
  Verification. Members pages 25 at a time with Load more, keeps `q` in the
  URL and renders cards on mobile; Link Fields show at most six rows, including
  on initial open;
  past 5,000 parties the Party Link Field, palette and parties page search
  the server. Remaining: check each in the running app on desktop and mobile
  in both themes, and the party search on an Organization seeded past 5,000
  parties. Register Party menus are removed; a linked Party filter resolves its
  chip by one Party id.
- **Client patterns**: Active. Slice 3 row focus and volume checks, a 5,000-row
  sort measurement, the H4 runs, and slice 5 import. Slice 4 is implemented
  and runtime verified with accounting-core slices 4a and 4b-i; slice 5's
  Journal, Opening Balance, lock, Payment, Bill and note forms are implemented.
- **Invoice pages**: Verification. On the production build at 1440 and 390 px,
  light and dark: New opens `/invoices/new`, Save Draft moves to
  `/invoices/$invoiceId/edit`, Post opens the record Sheet, and a draft reopens
  from the record with every field. Open: keyboard-only entry, the post toast and reset,
  a stale-draft CONFLICT closing the editor, and a real phone.
- **[Invoice editor](./specs/invoice-editor.md)** and
  **[ship-to](./specs/invoice-ship-to.md)**: Verification. Built and checked
  in the dev app at desktop and 390 px (light and dark): Bill-to card, ship-to,
  live quote, discount, split and partial payment, MRP hint, draft reopen, and
  the PDF. Open: a GST-registered organization's CGST/SGST and IGST quote and
  the PDF's reverse-charge line in the app (covered by tests), and a reopened
  draft line repeating the item name as its description.
- **Bills, payments and notes**: Verification. Open: hands-on form entry for
  Bill lines, TDS and ITC; Payment against Bills and as a refund; Credit and
  Debit Note pages; Invoice discount, counter sale and amend; and Receipt
  adjustments at 1440 and 390 px in both themes. API flows, record Sheets
  and mobile list and form rendering were exercised. Headless browser limits
  blocked screenshots and form automation. Dates now format from a fixed
  month table, so hydration error #418 ("Sep" versus "Sept") should be gone:
  confirm on the Invoices, Payments and Notes lists. Also open after the
  review fixes: the shared Allocations table with Reverse on the Invoice,
  Bill, Note, Payment (an advance applied later) and Receipt Sheets; the
  shared open-items table with Fill and totals in the Receipt and Payment
  forms, and Payment write-offs; Apply credit on a Bill opening only on
  demand; the Note form's line-level refusal; the Payment method field in
  the Invoice, Receipt and Payment forms; the organization prefix fields;
  the Invoice PDF totals (Subtotal and Discount only with a discount); the
  Invoice PDF's Authorised signatory line and its single PDF link; ITC ticked
  on a new Bill line; and the Organization form without a time-zone field.
- **Organization settings**: Verification. After `bun run db:seed -- --reset`
  (it deletes local data), create an organization, then save and reload its
  settings, including the Payment prefix.
- **Single address field**: Verification. Party and Organization forms now use
  one multiline Address field. The receipt and tenancy tests pass. The local
  database has the regenerated baseline; reset any other disposable database
  still on the old baseline before migration. Check create, edit, save and
  reload on desktop and mobile in both themes.
- **Banking**: Verification. Add account opens the Add account Sheet in
  Banking with Bank Accounts chosen; saving it opens Add payment method with
  the new account chosen. Open: add a bank account and its method that way,
  then mark the method inactive and active again. Post a receipt
  with it and confirm the balance moves; cancel it and confirm the balance
  returns. Confirm that marking the account inactive is refused while the
  method is active. Mark the method inactive, then its account, then the
  method active again, and confirm Banking shows "Account inactive" and the
  Receipt form no longer offers the method. Sign in as a CA and confirm accounts, balances and methods are
  visible without add and status actions.
- **Chart of accounts and journal pages**: Verification. Headless checks cover
  the chart, journal entry and record, Banking, Items, Locks and Opening
  balance at 1440 and 390 px. Open: screenshots at 1440, 1024 and 390 px in
  both themes, including read-only chart and Items rows (no edit link) and the
  mobile GST supply class; the sidebar active row (`SidebarMenuButton`);
  keyboard-only journal entry; a hands-on pass on a real phone. Also open: the
  Opening balance mobile Total row at 390 px; typing a debit into a line with a
  credit (and back) clears the cleared side's error; the Journal, Invoice and
  Receipt record dates show the year at 390 px, and list days show it outside
  the current year.
- **Opening balance and locks**: Verification. The entry form and both lock
  Dialogs are checked on desktop and mobile in both themes; the exception
  Dialog rejects nonexistent organization-local DST times.
  Open: post, cancel and re-post the Opening Balance;
  have the books lock refuse a Journal, grant an exception that admits it,
  and revoke it to refuse posting again. Check the tax lock refusing an exempt
  direct Receipt, a CA setting locks and granting exceptions without the post
  actions, and a valid exception expiry reading back unchanged in the
  Organization zone from a browser in another zone. In the lock Dialogs, Escape
  is ignored while saving, and a refetch while the Change Dialog is open keeps
  its original expected lock date.
- **Receipt "Advance for" field**: Verification. A goods advance posts; a
  taxable service advance shows the field error.
- **List period filter**: Verification. On Invoices, Receipts and the party
  ledger: each preset, the financial-year label across an April start, a custom
  range picked in the calendar popover, and clearing back to all time. Cover
  desktop and mobile, both themes, and keyboard-only movement through the
  calendar.
- **Blank data regions**: Verification. A slow-4G cold open and a screen-reader
  pass. A list whose refresh fails keeps its rows under a retry note; check it
  by dropping the network on a loaded list.
- **Touch hover and motion**: Verification. Every `hover:` style is gated to
  fine pointers in `globals.css`. Buttons, toggles, checkboxes, the Dialog
  close button and calendar days change state without a transition; the login
  buttons read `transition-duration: 0s` at 1440 and 390 px. Open: a pressed
  toggle, checkbox and calendar day at desktop and mobile widths in both
  themes, blocked until the local database is reset to the current migration
  baseline (see Query performance); a tap on a real phone leaves no stuck hover
  colour.
- **Production hardening**: Verification.
  [Release evidence](./operations.md#production-hardening).
- **Pilot readiness**: Active. A named owner records every
  [gate](./operations.md#pilot-readiness).
- **[Marketing homepage](./research/launch-and-homepage-2026-09-26.md)**:
  Verification. The Edernal preview uses the selected copy and palette, an
  8.1-second story loop and product previews. The owner has accepted its
  future-feature claims while the site stays private: production builds send
  `/` to login, return Not Found for other site routes and omit them from the
  sitemap. WhatsApp forms open a
  prepared message; the visitor must press Send. Open: confirm the public
  contact settings, founder copy acceptance, qualified-conversion evidence and
  the product capabilities promised before public launch. Check the Product
  menu's single-shelf layout on desktop.
- **Midday licence**: Blocked on Midday Labs. A written licence comes before the
  first external release.

## Rules

- Write in the present tense, in short sentences. No changelogs, dated status or
  benchmark logs: Git is the changelog.
- Change the owning page with the behaviour. Delete stale text.
- Add a page only when no owner fits. Research is evidence: fold each decision
  into its owner as one line.
