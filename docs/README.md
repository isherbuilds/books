# Accly Books documentation

Each page owns one area. Keep a fact in one place and link to it. Code is the
authority for exact APIs, schemas and permissions. End-user help lives in
`apps/fumadocs`; terms live in [`CONTEXT.md`](../CONTEXT.md).

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

- **[Accounting core](./specs/accounting-core.md)**: Active. Slices 4b-ii,
  6–7 and 9 (party lines on Journals, Journal credits and debits as allocation
  sources and targets), CA acceptance of every implemented slice, and the
  slice 2 posting p95 on native PostgreSQL at `db:seed:volume`. Slices 1–5 and
  8 are implemented; their open runtime checks are listed below.
- **Released credits versus advances**: Active. Decide whether a credit
  released by reversing an allocation is classified explicitly or recorded as
  a released credit distinct from an advance, before any tax workflow reads
  `advanceSupply` ([decision](./specs/accounting-core.md#slices)).
- **Settlement reads at volume**: Verification. Invoice open and overdue
  filters and `receipt.unapplied` sum each document's active allocations per
  row (`remainingPaiseOf`).
  Measure them on 100,000 Invoices with allocations before adding any stored
  balance.
- **[Keyboard focus](./design.md)**: Verification. One global rounded ring
  with `data-focus-inset` for full-bleed rows. Desktop light checks passed for
  the login autofocus, Sign in, settings tabs, sidebar search and a receipt row
  link, and the muted sidebar palette trigger passed in both themes. Remaining:
  mobile widths, dark theme, dialogs, menus, comboboxes and compact data-table
  rows. Cell-level text links sit about 2px from the ring.
- **Review fixes**: Verification. Run the journal, invoice, auth integrity and
  settings integration tests when Docker is available. Check the Product menu
  and group-hover links with mouse and touch at desktop and mobile widths, in
  both themes. Confirm a failed Load more request shows one retry control and
  a failed background refresh keeps its rows.
- **Client patterns**: Active. Slice 3 row focus and volume checks, a 5,000-row
  sort measurement, the H4 runs, and the remaining slice 5 forms. Slice 4 is
  implemented and runtime verified with accounting-core slices 4a and 4b-i;
  slice 5's Journal, Opening Balance and lock forms are implemented; remaining
  forms per client-patterns slice 5 stay open.
- **Invoice pages**: Verification. On the production build at 1440 and 390 px,
  light and dark: New opens `/invoices/new`, Save Draft moves to
  `/invoices/$invoiceId/edit`, Post opens the record Sheet, and a draft reopens
  from the record with every field. Open: keyboard-only entry, Post and next,
  a stale-draft CONFLICT closing the editor, and a real phone.
- **Organization settings**: Verification. After `bun run db:seed -- --reset`
  (it deletes local data), create an organization, then save and reload its
  settings, including the Payment prefix.
- **Banking**: Verification. Add account opens the Chart of accounts Add account
  Sheet; pick Cash or Bank Accounts there. Open: add a cash account and a payment method that lands
  in the new bank account, then archive and restore the method. Post a receipt
  with it and confirm the balance moves; cancel it and confirm the balance
  returns. Archive the account behind a restored method and confirm Banking
  shows "Account archived" and the Receipt form no longer offers the method.
  Sign in as a CA and confirm accounts, balances and methods are visible
  without add and archive actions.
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
  fine pointers in `globals.css`, and buttons, toggles and field messages no
  longer animate. Open: a tap on a real phone leaves no stuck hover colour.
- **Production hardening**: Verification.
  [Release evidence](./operations.md#production-hardening).
- **Pilot readiness**: Active. A named owner records every
  [gate](./operations.md#pilot-readiness).
- **Marketing captures**: Verification. The public pages, FAQ and changelog
  describe the accounting product, with captures of the Invoices, Parties and
  Receipts screens from local seed data. Open: a founder's review of the copy,
  and the Product menu's single-shelf layout on desktop.
- **Midday licence**: Blocked on Midday Labs. A written licence comes before the
  first external release.

## Rules

- Write in the present tense, in short sentences. No changelogs, dated status or
  benchmark logs: Git is the changelog.
- Change the owning page with the behaviour. Delete stale text.
- Add a page only when no owner fits. Research is evidence: fold each decision
  into its owner as one line.
