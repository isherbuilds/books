# Design

The UI source of truth. Every rule is a default. A deviation needs a comment,
and a deviation that recurs is a missing primitive.

## 1. Surfaces

Canvas `bg-background`, shell `bg-muted` and card `bg-card` + `border-border`
must stay visibly distinct. If a shell disappears, fix `--muted` in
`globals.css`, not the page.

- Accounting-core lists use `DataTable`: one flat `rounded-lg border bg-card`
  box, with no shell and no label row.
- A page with several short lists (Banking, Locks) uses `ListSection`: a muted
  label row over one `rounded-lg border bg-card` box.
- A settings or files list gets one tray: `rounded-xl bg-muted p-1`, an `h-9`
  muted label row and a `rounded-lg border bg-card p-4` body.
- Everything else is flat sections with type and hairlines. Never nest a shell
  in a shell, or a card in a Sheet or popover.

## 2. Spacing

Steps: `1` (icon to label, chips, shell inset), `2` (controls in a row, label to
field), `3` (form fields, card grids), `4` (page and card padding, section gaps)
and `6` (public-page blocks only). No `5`, `7`, `9` or fractions.

- `PageBody` applies `p-4`. Pages never retune it, except a bottom reserve for a
  fixed mobile footer.
- Put `gap` on the parent, not margins on children. `PageHeader` owns the one
  optical nudge.

## 3. Type

| Size                  | Where                                        |
| --------------------- | -------------------------------------------- |
| `text-[0.6875rem]`    | `Badge`, `TableHead`, palette group headings |
| `text-xs`             | Body default: cells, labels, buttons, inputs |
| `text-sm`             | Page and section titles, the palette input   |
| `text-base`           | Dialog and Sheet titles                      |
| `text-lg`, `text-xl`  | Public pages                                 |
| `text-2xl`/`text-3xl` | A Document Sheet amount                      |
| `text-4xl`/`text-5xl` | Public headlines only                        |

- No route-level arbitrary sizes. Print sizes are the only other exception.
- Weight carries hierarchy: `font-medium` for titles and the active row. No
  `font-bold` in the app.
- `text-muted-foreground` is the only secondary colour, never an opacity.
- `font-mono` is only for identifiers read character by character (codes,
  phone, document numbers, GSTIN, PAN), never prose or amounts.
- `tabular-nums` goes on every number that can change.
- Member and master names are stored lowercase and render with `capitalize`.
  Never capitalize legal names, addresses, notes, references, identifiers or
  email.
- Inter Variable and JetBrains Mono are self-hosted. PDFs use Takumi's sans with
  Noto Sans Devanagari subsets. No CDN: the app works on an offline LAN.

## 4. Radius

Components own radius, derived from `--radius: 0.625rem`. Call sites never set
it.

| Radius         | Where                                     |
| -------------- | ----------------------------------------- |
| `rounded-md`   | Default for every `packages/ui` component |
| `rounded-sm`   | Checkbox and `Kbd`                        |
| `rounded-lg`   | Page-level cards in `apps/web`            |
| `rounded-xl`   | The card shell                            |
| `rounded-full` | `Button shape="pill"` (the sign-in CTA)   |

A page that writes `rounded-*` builds a shell, or its component lacks a variant.

## 5. Colour

Use theme tokens only: `bg-background`, `bg-card`, `bg-muted`,
`text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`,
`text-destructive` and the status tokens. Palette utilities do not invert.
Check light and dark. Light `--muted-foreground` is `oklch(0.5 0 0)` for 4.5:1
on every surface.

- Colour means state, and a `Badge` always carries the word.
  `text-destructive` marks a failure to act on.
- Status severity: `--status-alert` (money owed, overdue), `--status-note`
  (provisional), `--status-clear` (settled or absent) and `--status-info`
  (neutral identity). Each has `-surface` and `-border` in both themes.
- Exceptions: paper is black on white in every theme; the login panel is fixed
  dark; the landing wash stays light and sits only behind screenshots.

## 6. Icons

Lucide only: `size-3.5` in the shell, `size-4` inside buttons and inputs (the
component sets it), and `size-5` or more only for empty-state art. A bare icon
button needs `aria-label`. Without a picture, use `Monogram` (`size-6`, and
`tone="accent"` on `bg-card`); never hand-roll initials.

## 7. Sidebar

- `lib/navigation.ts` owns the groups: Home, then Sales, Purchases, Masters and
  Accounting. Settings is the footer link; its tabs hold the rarely opened
  pages (Opening balance, Locks, Files, Audit), as Zoho files them.
- The rail is a plain `<aside>` in `components/app-shell.tsx`, not the shadcn
  Sidebar: it server-renders with the page and has no provider, cookie, resize
  listener or per-row Tooltip. Only the account menus mount on the client.
- Each group is a native `<details>`, open by default. A member collapses the
  groups they never use; navigating into a collapsed group reopens it, so the
  active row is never hidden. The rail fits a 768 px screen, so there is no
  Zoho-style accordion: one open group would cost a click per switch and move
  rows under the pointer. `name="nav"` on the `<details>` makes it one if ever
  wanted. The chevron shows only on hover, focus, or while collapsed.
- The rail is flat on the canvas (`--sidebar` equals `--background`); the
  content panel is the raised card.
- Hover changes only the background to `bg-sidebar-accent/60`. The active row
  uses the full accent and a foreground icon; label weight and width stay
  fixed, and colours never transition on this frequent action.
- The desktop rail is an `<aside>`. Below `lg`, `PageHeader` opens the same nav
  content in a modal `Sheet`. A link, the backdrop or Esc closes the sheet.
- The second header row is the palette trigger: "Find anything…" with its Mod+K
  `Kbd`. The palette finds Parties and, by number, Party or reference, every
  Invoice, Receipt, Bill, Payment and Note.
- The org switcher keeps the section: Invoices in one organization opens
  Invoices in the next; a record page opens its register. The theme choice lives
  in the user menu.
- Links preload on hover or focus with zero delay, never all at mount.
- Focus is one global unlayered `:focus-visible` rule in `globals.css`: a 2.5px
  rounded ring 2px off the element. Full-bleed targets inset it; components add
  no rings of their own. Hover styles are gated to `(hover: hover) and (pointer: fine)`:
  `globals.css` redefines Tailwind's `hover:` variant.
- The skip link is the first focusable element and targets `#main`.

## 8. Layout primitives

They live in `apps/web/src/components/page.tsx` unless named. A new wrapper
means a primitive lacks a prop.

- `PageBody`: `p-4 gap-4 text-xs`. Every org page starts with it.
- `PageHeader`: the single pinned 48 px title band with the Sheet trigger;
  `px-3 gap-3` below `lg`, `pl-6` beside the rail.
- `ErrorNote` is the only failed-read report. `PageTabs` is the only tab strip.
- `ListToolbar`: search, then chips, then an `end` slot for the column menu.
- `SearchInput` mirrors the URL `q`. It applies after 300 ms (server) or 150 ms
  (memory), or on Enter. Esc clears the text. A `trailing` slot holds the
  filter button.
- `FilterMenu`, `FilterSubmenu` and `FilterChips` (`list-filter.tsx`):
  accounting filters, with a submenu per dimension, removable chips, then Clear.
- `DataTable` (`components/data-table/`): a sticky muted header, hairlines,
  single-line rows led by the row `Link`, optional row actions, `aria-sort` on
  complete masters, cards below `md`, and states through `ListState` and
  `TableEmpty`.
- `Panel`: the tray for settings and files lists.
- `ListState` is the only pending, error, retry and empty branch. `LoadMore` is
  the only way a list grows: it shows the count and fetches the next 25 rows.

**Choice controls.** Use a dropdown menu for actions and short option lists,
including filter checkboxes. Use radio items for one-of-many choices such as
theme. Use a popover for anchored interactive content such as the custom date
calendar. Use a combobox when someone types to find and choose a record. Menu
rows stay inset within their popup, with related items grouped before a
separator.

**Header grammar.** A title is a static noun of up to two words, never data.
Context goes in the description (`Code · Name`, or a short phrase without a full
stop). A date appears only when it is interactive. Actions sit right at 32 px
(`icon` if icon-only); in-body actions are `size="xs"`. Create labels carry no
plus icon, except the Create row in a picker. Buttons render Title Case through
the primitive. Record tabs share one title; Settings tabs keep their own.
Section labels are muted `text-xs`, and flat label rows are `min-h-6`.

**List grammar.** Search, filters, sort and columns are URL state. A record
opens in a right Sheet over the mounted list unless it carries a line grid. A
record with a line grid is a page (`journals_.$journalId`), like a Party that
outgrows a Sheet. Closing a Sheet refocuses its row. Records never open in a
side pane. Operational tables never scroll sideways: below `md` rows become
compact cards (`px-3 py-2 border-b`, identifier, name and status first). The
card stacks its lines with `gap-1`; a `*Card` renderer returns a fragment and
sets no margins. Report and print tables may scroll.
Scrollbars are 6 px; the rail hides its own. `DataTable` rows stay single-line:
truncate with a `title`, keep identifiers whole, and hide optional columns below
a breakpoint. Elsewhere long text wraps (`break-words`) or truncates with a
`title`; an identifier that outgrows its row gets `table-fixed` and `break-all`.

**Exempt surfaces.** Public entry pages (`login`, `join`, `create`, `/`) skip
`PageHeader` and may use larger type. Paper is black on white, with bold weights
and physical sizes. Receipt PDFs are Takumi HTML with a repeating `<thead>`,
bundled fonts and aligned numerals.

## 9. Density and emptiness

- An empty panel keeps its `min-h-*` height and says what would be there ("No
  payment methods yet", not "No data").
- Nothing stands in for data that has not arrived. Render the chrome from route
  params and leave the data region empty; a `DataTable` header may show first.
  No skeletons.
- The palette is keyed on the organization. It shows document results for the
  current search as each register responds.

## 10. Task overlays

- One inset Sheet serves every width: large radius, `border-8 border-muted`.
- A Dialog holds up to about four fields and one decision: a lock, lock
  exception, invite or cancellation with a reason.
- A Sheet holds one vertical record: a party, item, money account, payment
  method or receipt.
- A Page holds a line grid: an invoice, a journal or an opening balance.
- A record Sheet uses flat sections split by `Separator`, never a `Panel`.
  Editing is `?edit=true` on the same Sheet. A record that outgrows a Sheet (a
  Party) gets a quick look plus a tabbed page. A Document Sheet leads with its
  amount at `text-2xl tabular-nums`, struck through when cancelled.
- Forms share header, scrolling body and footer across Dialog and Sheet, cap at
  `max-w-lg`, and use the `p-4` header and footer parts.
- `DocumentForm`, `PostBar` and `PostedView` render the same `SheetBody` and
  `SheetFooter` layout in a Sheet or on a page; the host does not change the
  form.
- Document footers render the Mod+Enter hint with `Kbd`.
- Entry lines are a Debit/Credit grid with a header row at `md`, per-cell labels
  below `md` and a totals row under the amount columns.
- Forms compose `Form`, `FormItem`, `RegisteredFormField` and `FormField`. Two
  to five choices use `ToggleGroup`. A long form splits into flat sections under
  muted `h3` labels, never an accordion.
- Chart creation picks the parent with a `NativeSelect` grouped by account type
  (a type's top level or an existing group), then the name; codes are generated,
  not another input to complete.
- Single-choice pickers use `LinkField`; a fixed list (states, legal types,
  months, time zones) goes through `OptionField`. `NativeSelect` stays only
  where `<optgroup>` grouping carries meaning (chart parent, payment-method
  account), for the Reports period preset, which shows a non-selectable
  Custom state, and for the Receipt's "Advance for" supply, which opens on a
  disabled "Choose supply" prompt.
- A Sheet moves only by its 150 ms opacity and slide transition; list and
  keyboard actions stay static.
- Transient notifications sit at the top center with an explicit close button,
  away from form footers. They never disable pointer events on toast actions.

## 11. Motion

Entrances use `ease-out` under 200 ms and animate `transform` and `opacity`
only. Frequent actions do not animate: buttons, toggles, checkboxes and field
messages change state without a transition. `globals.css` handles
`prefers-reduced-motion`.

## 12. Money and numbers

Right-align numbers and left-align text. Money rules are in
[Development](./development.md#code-rules).
