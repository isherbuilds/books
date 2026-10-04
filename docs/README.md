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
  Active. [D1–D16](./specs/accounting-core.md#decisions-2026-10-04) are recorded.
  Built and verified on branches (PRs #39–#47): D1–D3 (including the Opening
  Balance/business race fix and regression test), D4, D5, M6, D8, D11,
  D13/D15, D16 and M10. M6 fixes a render-subscription bug; no automated test
  exists without a component harness. D11 does not refresh an open page at
  midnight. M10 first-page p50 fell from 14.8 s with timeouts to 62–145 ms;
  16-worker load rose 43→72 req/s, errors 7→0
  ([method](./specs/query-performance.md#current-read-measurements)).
  Remaining: D6 supplier refund Receipt and D7 proportional TDS on Debit Notes
  (M7/M8), M14–M17 (join page, phone invite form, password reset copy, join
  audit), and the minor/polish lists. M12 is closed by D12, not a blocker.
  Next: build D6/D7 and resolve the remaining findings against their owner docs.

- **[Combobox input simplification](./specs/client-patterns.md)**: Verification.
  One mounted input, Enter selection, Tab progression, clearing a saved choice
  by typing, empty results, and Apply Credit selection/focus/disable behavior
  passed at desktop and 390 px in both themes. Same local fixture, 24 alternating
  invoice party searches, Chrome dev mode, input event to second animation frame:
  median 18.7→13.7 ms, p95 31.4→30.7 ms. LinkField chunk 16.52→14.61 kB gzip;
  three picker files 755→686 lines. Next: exercise Load more with over one page
  of open credits.
- **[Client bundle trim](./architecture.md)**: Verification. Client gzip JS
  669.1→648.2 kB (`bun --bun vite build`, `assets/*.js` summed at gzip -9):
  dependency-free `*-kinds.ts` removes Drizzle (−10.5 kB); the throwing
  `Command.Dialog` alias removes unused Radix dependencies (−10.4 kB).
  Palette open/filter/Esc passed without console errors. Next: 390 px and dark theme.
- **[Apply Credit form cleanup](./specs/client-patterns.md)**: Verification.
  Combobox owns open state; lint/format passed, production build passed before
  the concurrent Combobox edit. Next: type check and selection, Load more and
  keyboard checks in the running app.
- **[Query performance](./specs/query-performance.md)**: Active. Remaining:
  S4 party statement refusal timing and S7 close-out. Next: time refusal and
  reconcile deferred gates; use `db:seed:mega` for mega-volume checks
  (local database is at the current baseline with `db:seed:volume`).
- **[Loading indicators](./design.md#8-layout-primitives)**: Verification.
  List, picker, invitation, join, allocation and opening-balance waits use
  `WaveLoader`; types, lint and build passed. Next: inspect waits once local
  web/API proxy processes respond.
- **[Cooler light palette](./design.md)**: Verification. Public desktop/phone
  rendering, contrast test and production build passed. Next: authenticated
  light/dark console check once local web/API services start.
- **[Accounting core](./specs/accounting-core.md)**: Active. Slices 1–6, 7a–7c,
  8 and 9 are implemented. Import integration/request-lifecycle coverage and
  valid/invalid workbook Check/Import passed; an edited file toasts "Choose it
  again", numeric State `7` saves as `07`. Slice 6 report/receipt/tenancy and
  unit coverage passed; Cedar report pages/downloads at 1440/390 px in both
  themes reconcile balance sheet → leaf → ledger → voucher, P&L net/current-year
  row and PDF content type. Slice 9a Journal form/record, Apply credit and party
  Ledger link passed at those widths/themes; 9b has journal integration coverage.
  [Performance evidence](./specs/query-performance.md#current-read-measurements).
  Remaining: 7d TallyPrime XML blocked on an anonymized real export; CA acceptance
  of every slice; slice 2 posting p95 on native PostgreSQL at `db:seed:volume`.
  Next: obtain the export and acceptance; check the Opening Balance picker
  without `receivables`, Journal Invoice picker after reversed refund, Fill
  against net party credit, recovery after a selected Invoice closes, Receipt/
  Payment Fill and totals after the grid refactor; Receipt open-items Journal
  debit, posting and Sheet allocation link. Measure Journal credits/debits under
  Settlement reads at volume below.
- **[Virtualized lists and paged ledgers](./design.md#8-layout-primitives)**:
  Verification. At 1440/390 px in both themes, SSR rows, auto-load, bounded mounted
  rows, continued balances, final Closing row and Sheet-close row focus passed.
  Light-theme checks passed: Meridian Invoice ArrowDown 0→60 and ArrowUp return,
  cold day-book viewport fill at both widths, failed party search error, cached
  day-book party rename. [Performance evidence](./specs/query-performance.md#current-read-measurements).
  Next: those four checks in dark; scroll to list end during refetch (no next-page
  request until settled); legal-name edit refreshing cached report header;
  Parties table/highlight filling its bordered box after spacer fix; 5,000-party
  register (local seed has 94); Party Ledger and five report PDFs opening without
  Base UI native-button warnings. Consider period roll-ups if summaries miss the
  native-PostgreSQL report budget.
- **[Settlement reads at volume](./specs/query-performance.md)**: Verification.
  Next: measure unfiltered Invoice/Bill/Note pages, open/overdue filters and both
  pickers on 100,000 Invoices/Bills with allocations. Check whether pickers need
  `(org, party, document date, id)` indexing. Seed Journals: the pickers' `exists`
  OR arm on `party_ledger_lines` cannot use the party document index; the volume
  seed has none. If slow, drive pickers from `party_ledger_lines_org_party_idx`
  (one post line per settling document/party, sign distinguishes source/target).
- **[Mega volume seed](./specs/query-performance.md)**: Verification.
  `db:seed:mega` targets Meridian/Ridgeview/Cedar at 1M/5M/15M total documents
  with linked document, journal, ledger and allocation rows. Next: run locally,
  confirm final counts and measure registers/reports.
- **[Keyboard focus](./design.md)**: Verification. Desktop light passed login
  autofocus, Sign in, settings tabs, sidebar search and Receipt row link;
  muted palette trigger passed in both themes. Cell links sit about 2px from
  the ring. Next: mobile, dark, dialogs, menus, comboboxes and compact table rows.
- **[Choice controls](./design.md#8-layout-primitives)**: Verification.
  Signed-in desktop org/account menus, active-org mark, theme radio and Esc
  passed in both themes. Next: filter submenus, date popover, record combobox,
  keyboard focus, edge placement, empty results and mobile in both themes.
- **[Navigation, Home and Reports](./design.md)**: Verification. Rail/groups,
  Home, Reports' four XLSX downloads, palette document search and section-keeping
  org switch passed on desktop in both themes and 375 px drawer. Next: keyboard
  collapsed groups/drawer; Home row height while short-viewport rail scrolls;
  `account.moneyBalances` timing on volume data. Party hub remains unbuilt.
- **[Review fixes](./specs/client-patterns.md)**: Verification. Next: journal,
  invoice, auth-integrity and settings integration tests when Docker is available;
  Product menu/group-hover links with mouse/touch; failed Load more showing one
  retry; failed background refresh retaining rows.
- **[Stale allocation recovery](./specs/client-patterns.md)**: Verification.
  Next: in two Cedar sessions, select open Invoice/Bill in Receipt/Payment,
  settle from the other session and refresh open rows. Confirm Clear unavailable
  clears hidden amount/error and permits a new allocation.
- **[Limits rule](./specs/client-patterns.md)**
  ([#17](https://github.com/isherbuilds/books/issues/17)): Verification. Next:
  Members' paged search/mobile cards, six-row Link Fields including initial open,
  server party search in Link Field/palette/Parties beyond 5,000 parties, and
  linked Party-filter chip resolved by id (no register Party menu).
- **[Client patterns](./specs/client-patterns.md)**: Active. Slice 4 is runtime
  verified with accounting-core 4a/4b-i; slice 5 forms are implemented. Next:
  slice 3 row focus/volume checks, 5,000-row sort measurement, H4 runs and slice 5
  import verification.
- **[Invoice pages](./specs/client-patterns.md)**: Verification. Production
  1440/390 px, both themes: New, Save Draft, Post Sheet and full draft reopen
  passed. Next: keyboard-only entry, post toast/reset, stale-draft CONFLICT
  closing editor and a real phone.
- **[Invoice editor](./specs/invoice-editor.md)** and
  **[ship-to](./specs/invoice-ship-to.md)**: Verification. Desktop/390 px in both
  themes passed Bill-to, ship-to, live quote, discount, split/partial payment,
  MRP hint, draft reopen and PDF. Next: registered-org CGST/SGST and IGST quote,
  PDF reverse-charge line (test-covered), and reopened item-name description.
- **[Bills, payments and notes](./specs/accounting-core.md)**: Verification.
  API flows, record Sheets and mobile list/form rendering were exercised;
  headless-browser limits blocked screenshots/form automation. Next: Bill
  lines/TDS/ITC; Payment against Bills/refund; Note pages; Invoice discount,
  counter sale/amend; Receipt adjustments. Confirm no hydration #418
  ("Sep"/"Sept") on Invoice/Payment/Note lists. Also check allocation Reverse
  on Invoice/Bill/Note/Payment (later-applied advance)/Receipt Sheets; open-items
  Fill/totals in Receipt/Payment and Payment write-offs; Bill Apply credit
  opening on demand; Note line refusal; shared Payment method fields; org
  prefixes; Invoice PDF discount-only Subtotal/Discount, Authorised signatory
  and single PDF link; default Bill ITC; Organization form without time zone.
- **[Organization settings](./specs/accounting-core.md)**: Verification.
  Next: create an org, save/reload settings including Payment prefix.
- **[Single address field](./specs/accounting-core.md)**: Verification.
  Receipt/tenancy tests passed. Next: Party/Organization multiline Address
  create/edit/save/reload.
- **[Banking](./specs/accounting-core.md)**: Verification. Next: add bank account
  → payment method with account preselected; toggle method inactive/active;
  Receipt post/cancel changes/restores balance; active method prevents account
  deactivation; inactive account plus reactivated method shows "Account inactive"
  and disappears from Receipt choices. CA sees accounts/balances/methods without
  add/status actions.
- **[Chart of accounts and journal pages](./specs/accounting-core.md)**:
  Verification. Headless chart, Journal form/record, Banking, Items, Locks and
  Opening Balance checks cover 1440/390 px. Next: screenshots at 1440/1024/390 px
  in both themes, read-only chart/Items, mobile GST supply class, sidebar active
  row, keyboard Journal and real phone. Check Opening Balance mobile Total,
  debit↔credit clearing opposite-side errors; Journal/Invoice/Receipt record
  years at 390 px and list years outside current year.
- **[Opening balance and locks](./specs/accounting-core.md)**: Verification.
  Entry form/lock Dialogs passed desktop/mobile in both themes; nonexistent
  org-local DST expiry is refused. Next: Opening Balance post/cancel/repost;
  Journal lock refusal → exception → revocation; tax-lock refusal of exempt
  direct Receipt; CA lock/exception actions without posting; expiry round-trip
  from another browser zone; Escape ignored during save; refetch preserving
  an open Change Dialog's expected date.
- **[Receipt "Advance for" field](./specs/accounting-core.md)**: Verification.
  Next: goods advance posts; taxable service advance shows field error.
- **[List period filter](./specs/client-patterns.md)**: Verification. Next:
  Invoice/Receipt/party Ledger presets, April financial-year label, calendar
  custom range, All time and keyboard calendar movement.
- **[Blank data regions](./design.md#9-density-and-emptiness)**: Verification.
  Next: slow-4G cold open, screen-reader pass, dropping network on loaded list
  retains rows under retry note.
- **[Touch hover and motion](./design.md#11-motion)**: Verification. Login
  buttons show `transition-duration: 0s` at 1440/390 px. Next: pressed toggle,
  checkbox/calendar day, and real-phone taps without stuck hover colour.
- **[Production hardening](./operations.md#production-hardening)**:
  Verification. Next: complete release evidence in the owner doc.
- **[Pilot readiness](./operations.md#pilot-readiness)**: Active. Next: a named
  owner records each gate.
- **[Marketing homepage](./research/launch-and-homepage-2026-09-26.md)**:
  Verification. Edernal preview has an 8.1-second story loop; WhatsApp forms
  prepare a message for the visitor to Send. Future-feature claims are accepted
  only while private ([routing](./architecture.md#web-data-flow)); production
  excludes site routes from the sitemap. Next:
  public contact settings, founder copy acceptance, qualified-conversion evidence,
  promised capabilities before launch and Product menu single-shelf desktop check.
- **[Midday licence](./specs/client-patterns.md#midday-adaptation)**: Blocked
  on Midday Labs. Next: written licence before first external release.

## Rules

- Write in the present tense, in short sentences. No changelogs, dated status or
  benchmark logs: Git is the changelog.
- Change the owning page with the behaviour. Delete stale text.
- Add a page only when no owner fits. Research is evidence: fold each decision
  into its owner as one line.
