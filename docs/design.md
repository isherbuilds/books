# Design

The rules this product's interface is built to. One document, so a screen built
next month looks like one built today without anyone comparing them side by
side.

Every rule is a default. A deviation needs a comment saying why, and a deviation
that recurs is a missing primitive, not a style choice.

## 1. Surfaces

Three greys, and they must stay distinguishable. This is the single most
important rule in the document, because the card language is built on it and it
collapses silently when two of them drift together.

| Surface | Token                       | What it is                                                 |
| ------- | --------------------------- | ---------------------------------------------------------- |
| Canvas  | `bg-background`             | The page. Flat sections and rationed card trays sit on it. |
| Shell   | `bg-muted`                  | The tinted wrapper that carries a card's label.            |
| Card    | `bg-card` + `border-border` | The raised surface that carries the content.               |

**Card trays are rationed against stacking, not against use.** A legacy
operational list (the OPD day list, the customers registry, record Charges or
Billing tables) gets exactly one tray. Accounting-core lists (Parties, Receipts
and every Document list after them) use the `DataTable` instead: one flat
`rounded-lg border bg-card` box with no shell and no label row, because the page
title already names the list (§8). Rationing means a
screen does not stack many trays and boxes in one composition: flat sections
with typographic hierarchy and hairlines are the default for everything that is
not a row group. A tray uses `rounded-xl bg-muted p-1`, an `h-9` label row, and
a raised `rounded-lg border bg-card` body. Never nest a card inside an
already-raised surface, such as a Sheet or popover.

```
┌ shell (bg-muted, rounded-xl, p-1) ──────────┐
│  label row (h-9, px-3, muted-foreground)    │
│ ┌ card (bg-card, border, rounded-lg, p-4) ┐ │
│ │  the content                            │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

The shell groups related rows. Do not nest a shell inside a shell.

**Do not tune these values per page.** If a shell is invisible, the token is
wrong, not the page — fix `--muted` in `packages/ui/src/styles/globals.css`.

## 2. Spacing

One scale. Five steps carry everything:

| Step       | Token          | Where                                            |
| ---------- | -------------- | ------------------------------------------------ |
| `1` (4px)  | `gap-1`, `p-1` | Icon→label, chips, the shell's inset             |
| `2` (8px)  | `gap-2`        | Controls in a row, label→field                   |
| `3` (12px) | `gap-3`        | Fields in a form, cards in a grid                |
| `4` (16px) | `gap-4`, `p-4` | Page padding, card padding, gap between sections |
| `6` (24px) | `gap-6`        | Between major blocks on a public page only       |

- **Page padding is `p-4`, applied by `PageBody`.** Pages do not retune the
  ordinary gutter. A task route may add bottom-only reserve when its fixed
  mobile action footer would otherwise cover the final fields.
- **Prefer `gap` on the parent over margins on children.** A margin is a decision
  only the child knows about; a gap is one the layout owns. `mt-*`/`mb-*` on a
  child is a smell — the sole exception is the optical nudge under a label, and
  `PageHeader` owns it.
- **`5`, `7`, `9` and fractional steps are not in the scale.** Reaching for `p-5`
  means the answer is `p-4` or `p-6`.

## 3. Type

A dense data surface. `text-xs` is the body size, not a small size.

| Size                      | Where                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `text-[0.6875rem]` (11px) | `Badge`, `TableHead` and palette group headings only: dense labels                      |
| `text-xs` (12px)          | Default: table cells, labels, body copy, buttons, inputs                                |
| `text-sm` (14px)          | Page and section titles, and the command palette input                                  |
| `text-base` (16px)        | Dialog and Sheet task titles                                                            |
| `text-lg` (18px)          | Public pages and a chart's fixed-height interactive readout                             |
| `text-xl` (20px)          | Public pages only                                                                       |
| `text-2xl`/`text-3xl`     | The headline number on a dashboard stat card, and the amount on a Document record Sheet |
| `text-4xl`/`text-5xl`     | Display: marketing headlines on public pages only, never inside the app                 |

- **Display sizes stop at the app's edge.** `text-4xl`/`text-5xl` exist so the
  public pages — `/` and the per-feature marketing routes — can carry a headline
  at the size a reader expects from a product site. Nothing behind a login uses
  them: a dense operational surface
  that needs 36 px to state something has a hierarchy problem, not a size one.
- **No route-level `text-[13px]`-style values.** A missing step means the design
  is wrong, not the scale. The reviewed 11 px component labels above and print
  sizes measured against physical paper are the only type exceptions.
- **Weight carries hierarchy, not size.** `font-medium` for titles and the active
  row; regular elsewhere. There is no `font-bold`.
- **`text-muted-foreground` is the only secondary colour** — not an opacity, not a
  lighter grey.
- **`font-mono` is for identifiers compared character by character**: customer code,
  phone, invoice number, token, actor id, item code, GSTIN, PAN. Never prose, never
  amounts.
- **`tabular-nums` on every number that can change** — counts, money, times. Without
  it a live-updating figure jitters.
- **Normalized names use `capitalize`.** Member names and short master-data names
  are stored in lowercase; their inputs and visible labels use Tailwind's
  `capitalize` utility. Do not apply it to legal names, addresses, notes,
  references, identifiers, or email addresses.

Customer facts must look as honest as they are stored: every age derived from an
estimated birth date carries a `~` prefix, and registration never preselects a
sex value for the operator.

**Fonts.** Inter Variable (UI) and JetBrains Mono (identifiers), both self-hosted
via `@fontsource-variable/*`. Billing PDFs pair Takumi's shipped Latin sans with
static Noto Sans Devanagari subsets for fixed metrics and script coverage. No
CDN: the app must work on an office LAN with no outbound internet.

## 4. Radius

Set by the component layer, never at a call site.

| Radius         | Where                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `rounded-md`   | The default. Every component in `packages/ui`: controls, dialogs, sheets, popovers, tooltips, empty states |
| `rounded-sm`   | Checkbox and `Kbd` only — `rounded-md` on a box this small reads as a circle or a pill                     |
| `rounded-lg`   | Page-level cards in `apps/web`                                                                             |
| `rounded-xl`   | The card shell in `apps/web`                                                                               |
| `rounded-full` | `Button shape="pill"` only — currently the sign-in CTA alone                                               |

A component in `packages/ui` owns its radius. If a page is writing `rounded-*`,
either it is building a shell (allowed) or the component is missing a variant.

The base is `--radius: 0.625rem`; every step above is derived from it, so a
tier is changed once in `globals.css` and never at a call site.

## 5. Colour

Theme tokens only: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`,
`text-muted-foreground`, `border-border`, `bg-primary`, `text-destructive`,
`text-pending`, and `text-overdue`.

- **No palette utilities** (`bg-neutral-100`, `text-zinc-500`). They do not invert
  in dark mode, which is how a screen ends up unreadable in one theme.
- **Both themes are shipped, not one flipped.** Every screen is checked in light
  and dark before it is done.

Light `--muted-foreground` is `oklch(0.5 0 0)` so secondary text clears 4.5:1 on the canvas, card, and muted tray.

- **Four documented exceptions.** Print documents use `bg-white text-black
border-black` because paper is white with black ink in every theme; the login
  context panel is a fixed dark surface in both themes; the landing page's wash
  (`components/landing/wash.tsx`) is a decorative gradient pinned to its light
  values in both themes, because a wash that inverts becomes a different object
  and because a bright stage carrying a dark app window is the effect it exists
  for — it sits behind product screenshots only, never behind type; and status
  severity uses the named tokens below.
- **Status severity** is the one place hue carries meaning beyond tenancy
  state: `--status-alert` for what needs attention (a balance still owed, an
  overdue invoice), `--status-note` for what is provisional, `--status-clear`
  for what is settled or explicitly absent, `--status-info` for neutral
  identity such as a document number. Each has a `-surface` and a
  `-border` companion and is defined in both themes in `globals.css`. A hue here
  is a claim about the customer, never decoration — and the word is still
  present, so the meaning survives for a reader who cannot see the colour.
- **Billing work state** uses `--pending` for Charges not yet invoiced and
  `--overdue` for an unpaid Invoice older than seven days. These tokens appear
  through labelled `Badge` variants; neither is a general accent colour.
- **Colour means one thing: state.** `text-destructive` for a failure the user must
  act on. Status is carried by a `Badge`, never by colour alone — the word is
  always present.

## 6. Icons

Lucide only. Never a second icon set.

| Size              | Where                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `size-3.5` (14px) | Inside the app shell: sidebar, table rows, card labels, picker and palette rows. Optically matches `text-xs`. |
| `size-4` (16px)   | Inside a `Button` or input — the component sets this; do not override.                                        |
| `size-5`+         | Empty-state illustration only, never an interface icon.                                                       |

A bare icon button needs `aria-label`. An icon beside text needs nothing.

**Where there is no picture, there is a `Monogram`** — the initials square used
for an organization, a member, a customer and a Party. One size (`size-6`), two
tones; on a `bg-card` row use `tone="accent"`, because the muted tone is `bg-card`. A
second hand-rolled initials box is the bug, not a style choice.

## 7. Sidebar

The rail sits flat on the canvas (`--sidebar` equals `--background`) and the
content panel is the card that rises off it. The rail is not a card.

- **Hover is `bg-sidebar-accent/60`, the active row is the full accent plus
  `font-medium`.** They must not be the same value, or the current page is
  indistinguishable from whatever the pointer is passing over.
- **Nav icons are `text-muted-foreground` until the row is active.** This is the
  one place secondary colour is applied to an icon rather than to text.
- At widths below `lg` (including tablets), the rail is an off-canvas Sheet.
  `PageHeader` owns its trigger; pages and fixed footers never compensate for a
  collapsed desktop rail themselves.
- The second row of the sidebar header, under the organization switcher, is the
  command palette trigger: "Find anything…" with its Mod+K `Kbd`. It opens the
  same palette as the shortcut.
- Primary and Settings destinations use zero-delay intent preloading. Pointer
  hover or keyboard focus warms route code and query data without eagerly
  running every sidebar destination loader when the shell mounts.

Keyboard focus is the global unlayered `:focus-visible` rule in `globals.css`;
do not remove or replace it with component-only rings. Hover effects are gated
to `(hover: hover) and (pointer: fine)`.

The skip link is the first focusable element and targets `#main` on every page root.

## 8. Layout primitives

Reach for these before writing a `div` with padding. All in
`apps/web/src/components/page.tsx`.

- **`PageBody`** — the page container: `p-4`, `gap-4`, `text-xs`. Every page inside
  the org shell starts with one.
- **`PageHeader`** — title, optional description, optional action. It renders the
  page's single 48 px title band, including the off-canvas sidebar trigger. A
  page never adds a second title or mobile trigger. It stays pinned to the top
  of the shell's content scroller; the body scrolls beneath it. Horizontal
  padding is `px-3` below `lg`, with `gap-3` between its menu trigger and title.
  Once the desktop rail is visible, the title uses `pl-6` for the small optical
  inset it needs beside the raised content panel.

**Page-header grammar.** Every page uses `PageHeader`. The title is a static noun
of at most two words. Never put data in the title. Put durable context in the
description: `Code · Name` or `Token N` identity on record pages, or a short phrase
with no trailing period. A date appears only when it is an interactive part of
the screen: operational day navigation belongs in the header action area, while
screens fixed to today (such as Dashboard) do not repeat today's date. Actions
align to the right in the header. Sibling record tab pages — views of one entity,
like the OPD record's Clinical and Billing — share one title and description, so
switching tabs does not shift the layout. Section tabs over distinct pages, like
Settings, keep their own titles.

Page-header actions use the default 32 px control height (`icon` when icon-only),
including secondary actions and operational date navigation. This keeps sibling
pages aligned without route-specific height overrides. In-body section and row
actions use `size="xs"`.
Creation actions are text-first. Labels such as `New`, `Add`, `Register`,
`Invite`, and `Create` do not repeat their meaning with a leading plus icon. The
one exception is the synthetic Create row inside a picker list, which carries a
plus in its check column to mark an action among records.
Button labels render in Title Case through the shared button primitive; routes
do not add one-off text transforms.
Every section label — flat or in a tray — is muted `text-xs` at plain weight, so
no section label competes with the page title. Flat section label rows carry
`min-h-6`, so a section with an action and one without are the same height.

**Two surfaces are exempt from the org-shell rules.** Public entry pages
(`login`, `join`, `create`, the root screen) do not use `PageHeader`; they may
use `text-base` and larger, sentence titles, and the fixed dark context panel.
Paper uses a separate black-on-white document system: billing documents are
server-rendered PDFs shown in an iframe, while the OPD slip remains the
`data-opd-slip` print article. Paper keeps bold weights and physical
measurements by design; do not "fix" it toward app-shell conventions. Billing
PDFs use native semantic HTML/CSS in Takumi, including `<thead>` for repeated
page headings, and only application-bundled fonts. Money and other changing
numerals stay aligned because ragged digit columns are a document defect, not a
style choice.

- **`ErrorNote`** — the one way a page reports a failed read.
- **`PageTabs` / `PageTab`** — the one tab strip below `PageHeader`. `PageTab`
  keeps typed route links, active state, and tab styling consistent.
- **`ListToolbar`** — the row above a list. Search comes first, then active
  filter chips; an optional `end` slot on the right holds a list's column menu.
- **`SearchInput`** — the one search box. It shows the URL `q`, applies after a
  pause (300 ms for a server-searched list, 150 ms for an in-memory master
  list), applies at once on Enter, and Esc clears the text only. A `trailing`
  slot draws the filter trigger inside its right edge.
- **`FilterMenu` / `FilterSubmenu` / `FilterChips`**
  (`apps/web/src/components/list-filter.tsx`, Midday-derived) — the filter
  grammar of accounting-core lists. One filter button inside the search field
  opens a menu with a submenu per dimension and checkbox rows; a single-value
  dimension can be deselected. Each active filter is a removable muted chip after
  the field, followed by Clear.
- **`FilterGroup`** — a segmented, one-of-N list filter that cannot be
  deselected. For a fixed set of two to five options on legacy and settings
  lists.
- **`FilterSelect`** — the same filter as a native select. For options that come
  from data, or more than five, on legacy and settings lists.
- **`DataTable`** (`apps/web/src/components/data-table/`, Midday-derived) — the
  list of accounting-core records: a flat bordered box, a sticky sentence-case
  muted header, hairline cells, single-line rows whose first cell is the row
  `Link` (the whole row is clickable), an optional row actions menu, sortable
  headers with `aria-sort` on complete master lists, and card rows below `md`.
  It renders its states through `ListState` and a `TableEmpty` title, line and
  action.
- **`Panel` / `PanelEmpty`** — the muted tray, label row, raised card, optional
  footer, and centered empty copy for legacy lists, settings trays and reports.
  `grow` fills the page for the one list on an operational desk.
- **`ListState`** — the only pending, error, retry, and empty-state branch for a
  list.
- **`LoadMore`** — the count, and the keyboard and error fallback that grows a
  list. On a `DataTable` a scroll sentinel also grows it; on a `Panel` it sits in
  the panel footer.

**List grammar.** Every list page puts `ListToolbar`, with search first and
filters after it, above its list. Search, filters, sort and visible columns are
URL search state, so reload, Back and a shared link keep them. Accounting-core
lists use `DataTable` with the filter menu and chips; legacy and settings lists
keep a `Panel` with `FilterGroup` and `FilterSelect`. A record opens in a right
Sheet over the still-mounted list, never in a pane beside it: from its child
route (a Receipt) or a search param (`?party=`, the Party quick look). Closing
returns focus to its row. Read states come only from
`ListState`. A cursor list grows through `LoadMore`, which also shows the
count. Operational tables never scroll
horizontally: below `md` a list renders one compact card per row (`text-xs`,
`px-3 py-2`, `border-b`, the row's own link or activation handler) with the
identifier, primary name, and status on the first line and secondary facts
below, and the table returns at `md`. Report and print tables are the one
exception and keep the primitive's horizontal scroll. A scrollbar is 6 px on
both axes; the sidebar rail hides its own because a rail is not a data region.
A long text cell wraps with `break-words` when its content is why the reader is
there, or uses `max-w-0` with an inner `truncate` `div` and a `title` when it
is secondary. Identifiers stay whole: when one can outgrow the row, the table is
`table-fixed` with declared column widths and the identifier cell wraps with
`break-all`. In a `DataTable` rows are single-line: text truncates with a
`title`, identifiers stay whole, and optional columns hide below a breakpoint
instead of scrolling.

A new bespoke layout wrapper is a signal that one of these is missing a prop.

## 9. Density and emptiness

- **A panel holds its height when empty.** An empty dashboard should read as a
  dashboard with nothing in it, not as a collapsed page. Panels declare a
  `min-h-*` so the layout is the same shape at 0 rows as at 20.
- **Empty text states what would be here**, in `text-muted-foreground`: "The queue
  is empty", not "No data".
- **Nothing stands in for data that has not arrived.** A page renders only the
  chrome it can build from route params: its header band. The data region stays
  empty until the data lands. The panel's `min-h-*` makes that blank region read
  as an empty panel, not a collapsed page. A `DataTable`'s column header row is
  static chrome and may render first; skeleton rows stay forbidden.
- **One narrow exception:** the command palette keeps the previous receipt
  results while the next search runs. They belong to the same organization (the
  palette body is keyed on it) and are re-ranked against the live text, so only
  matching rows show.

## 10. Task overlays

- Mobile and tablet navigation use the same shared Sheet primitive; there is no
  breakpoint-specific duplicate. Every Sheet is inset from the viewport, uses
  the large radius, and carries an 8 px muted boundary (`border-8 border-muted`)
  around its full perimeter.
- Create and edit overlays for accounting records (Receipt, Party) open as a
  right Sheet at every width. A quick-create started inside one opens a
  same-width Sheet over it, so the operator sees one stack, never a panel over
  a centred dialog. Dialogs are for confirmations and short prompts.
- A record opens as a right Sheet over the list (§8). Its facts are flat
  sections split by `Separator`, never a `Panel` inside the Sheet, and editing
  is a mode of the same Sheet (`?edit=true`). A record whose history outgrows a
  Sheet (a Party) keeps a read-only quick look and adds a full page with tabs
  (Overview, Receipts, Ledger); the page owns editing through the edit Sheet. A
  Document record Sheet leads with its amount at `text-2xl tabular-nums`, struck
  through when cancelled.
- Focused forms use the same header, scrollable content and footer composition
  in both Dialog and Sheet presentations. Their content column is capped at
  `max-w-lg`; switching presentation must not rearrange the form.
- Overlay task titles are `text-base`; descriptions, labels, controls and errors
  are `text-xs`. Financial totals use weight and tabular numerals for hierarchy;
  the one display size is a Document record Sheet's amount (§3).
- Sheet and dialog chrome owns its spacing. Headers, bodies and footers use
  `p-4`; feature forms compose `SheetHeader`/`SheetFooter` or
  `DialogHeader`/`DialogFooter` rather than recreating their borders and padding.
- Forms compose `Form`, `FormItem`, `RegisteredFormField` (native inputs) and
  `FormField` (widgets). Sets of two to five choices use `ToggleGroup`; a long
  form splits into flat sections, each a muted `h3` after a `Separator`, never an
  accordion.
- Sheet motion is limited to the existing 150 ms opacity and directional
  transform transition. It communicates where the occasional overlay came from;
  frequent list and keyboard interactions remain static.

## 11. Charts

- **Pick the form from the data's job**, not from what looks good. Magnitude over
  time → bars. A single headline → a stat card, not a chart.
- **One series needs no legend** — the panel title names it. Two or more always get
  one.
- **Never a dual axis.** Two measures of different scale are two charts.
- **Colour is `currentColor`/tokens**, so the chart inverts with the theme instead
  of being flipped by hand.
- **Gap-fill time series in SQL.** A day with no rows plots as a zero, or the axis
  silently compresses and lies.
- **A bar chart is interactive by default**: per-bar hover, a readout that does not
  reflow the plot, hit targets the full column height.

## 12. Motion

- **Entrances `ease-out`, never `ease-in`.** Keep UI motion under 200ms.
- **`transform` and `opacity` only.** No animating width, height, or top.
- **The more frequent the action, the less it animates.** A view switch a user
  performs 100 times a session gets no transition at all.
- **`prefers-reduced-motion` is handled globally** in `globals.css`; do not
  re-implement it per component.

## 13. Money and numbers

- **Right-align numeric table columns**; left-align text.
- Money types and formatting follow [Development: Code rules](./development.md#code-rules).

## Checklist before calling a screen done

- [ ] When a card tray is used, canvas, shell and card are three visibly distinct surfaces.
- [ ] Card trays group related rows only; flat sections use hairlines and typography, and no card sits inside a raised surface.
- [ ] No route-level arbitrary values; only the documented component and print exceptions.
- [ ] Every colour is a token; checked in light **and** dark.
- [ ] Spacing uses the scale; no margins on children where a gap would do.
- [ ] `tabular-nums` on every changing number; `font-mono` on identifiers.
- [ ] Icons are Lucide at `size-3.5`/`size-4`.
- [ ] Panels hold their height when empty, and say what would be there.
- [ ] No placeholder stands in for loading data.
- [ ] The page uses `PageBody` / `PageHeader`, not a bespoke wrapper.
- [ ] Accounting-core lists use `DataTable`; search, filters, sort and columns live in the URL; nothing scrolls sideways at `md` and up.
- [ ] A record opens in a right Sheet over its list; there is no side pane.
