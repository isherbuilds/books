# Money handling: one bigint from database to screen

## Question

Money takes many conversions between Postgres and the screen. Can parsing,
formatting and transport be simpler, smaller and faster while every amount
stays exact? Which representation (`number`, `bigint`, or a decimal library)
and which display path fit this app?

Research date: 2026-09-11. Installed versions: oRPC 1.15.0, Drizzle ORM
0.45.2, node-postgres 8.23, Zod 4.5.4, TypeScript 7.0.2, React 19.2.8,
TanStack Query core 5.102.8, TanStack Start 1.168.49 (seroval 1.6.2), Bun
1.4.0, Node 24.21. This note changes no code or contract.

## Answer

Keep integer paise as `bigint` from the database to the screen, and stop
converting it on the way.

- **Outputs carry `bigint`.** oRPC's RPC protocol, the in-process router
  client, TanStack Start SSR and React 19 carry and render `bigint` unchanged.
  The server calls that build decimal strings, and the client parses that turn
  them back into `bigint`, have no job left.
- **One display function.** `formatMoney(paise)` passes `` `${paise}E-2` `` to
  one module-level `en-IN` INR `Intl.NumberFormat`. Intl reads that string
  exactly at any size, with no float. INR is the only currency an organization
  can hold, so the currency argument goes.
- **One parse function** for typed rupees, as today. Typed money inputs stay
  decimal text, because TanStack Query hashes query inputs with
  `JSON.stringify`, which throws on `bigint`.
- **Decimal text stays only where JSON must hold money**: audit metadata,
  error text and form pre-fill. XLSX cells take `Number(paise) / 100`, which is
  exact to 15 digits.
- **Avoid** `number` paise with raw `*` and `/`, `Math.round` on money, decimal
  libraries, the Postgres `money` type, and the TC39 Decimal or Amount
  polyfills.
- **Runtime is a wash.** `bigint` decodes about 2.5× slower than a string, but
  the server stops formatting and the browser stops re-parsing. The largest
  measured report moves from about 6.3 ms to 6.7 ms in Node; a hand-written
  en-IN formatter would bring it to 5.0 ms at the cost of owning the grouping
  rule. The change also removes today's display failure for totals of
  ₹10 lakh crore and above.

Almost every money call site is in the legacy outpatient and billing domain
that accounting-core slice 7 deletes; the new core imports no money code yet.
That sets the size of the change, not its direction.

Decision, 2026-09-12: the owner chose the contract-and-module scope.
Accounting-core call 2 and design section 13 carry the contract, and
`packages/api/src/core/money.ts` provides `formatMoney` for display and
`formatDecimal` for plain text. Legacy procedures keep decimal strings until
slice 7 deletes them. Follow-ups are tracked in accounting-core slices 1, 2, 4
and 7, in client-patterns slice 1, and in the money rules of
`docs/development.md`.

## Evidence

### Conversions today

Repository inventory of the 2026-09-11 working tree.

- **Server:** 112 `formatMoney` calls turn `bigint` into decimal strings. 100
  build output for 27 procedures, 9 write audit metadata, 1 is error text.
  `formatMoneyKeys` adds 13 more (`packages/api/src/routers/billing.ts:52-77`).
- **Web display:** 120 `formatMoney(amount, currency)` calls in 24 files. Each
  parses the string to `bigint`, formats it back to a decimal string, then runs
  Intl (`apps/web/src/lib/money.ts:17-27`).
- **Web arithmetic:** 21 `parseMoney` calls rebuild `bigint` from server
  strings. 5 calls format a `bigint` only to parse it again, for example
  `formatMoney(formatDecimal(paise), currency)` in
  `apps/web/src/lib/settlement.ts:127`.
- **Name clash:** the web imports the server's `formatMoney` as
  `formatDecimal` (30 calls), because two modules export different functions
  under one name.
- **Raw SQL:** node-postgres returns `int8` and `sum()` as strings. There are
  42 `::bigint` casts, 34 `sum()` calls and 31 `BigInt(row.x)` conversions; 12
  of those are `formatMoney(BigInt(...))`.
- **Currency:** `organization_settings.currency` is text set to INR at
  creation. An update matches the stored value, so any change returns CONFLICT
  (`packages/api/src/routers/settings.ts:140`,
  `tests/integration/tenancy.test.ts:38,53`), and the settings field is
  read-only. The value still reaches all 120 display calls.
- **Exports:** five report routes build XLSX cells with `Number(decimal)` (59
  lines); `apps/web/src/lib/report-export.ts` passes rows through unchanged.
- **Scope:** `routers/organization.ts`, `routers/party.ts` and
  `core/organizations.ts` import no money code. Every importer of
  `packages/api/src/core/money.ts` is legacy code, its tests, or
  `scripts/seed-demo.ts`.

### Library support

Checked in `node_modules` and with isolated probes.

| Path                                 | `bigint`                                                               | Evidence                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| oRPC RPC output and input            | Round-trips as `{"json":{"amount":"123"},"meta":[[0,"amount"]]}`       | `@orpc/client@1.15.0/dist/shared/client.BtiuJPEa.mjs:111-113,200-201`                                      |
| `createRouterClient` (SSR, PDF)      | Passes through untouched                                               | `@orpc/server@1.15.0/dist/index.mjs:467`                                                                   |
| OpenAPI handler (development only)   | Output becomes a JSON string; string input to `z.bigint()` returns 400 | `@orpc/openapi-client@1.15.0/dist/shared/openapi-client.B2Q9qU5m.mjs:44-45`                                |
| TanStack Query key hash              | Throws on `bigint` in a query input                                    | `@tanstack/query-core@5.102.8/build/modern/utils.js:56-61`                                                 |
| TanStack Query structural sharing    | Works; leaves compare with `===`                                       | same file, line 91                                                                                         |
| TanStack Start SSR                   | seroval 1.6.2 serializes and revives `bigint`                          | `seroval@1.6.2/dist/index.js:1095,2257`                                                                    |
| React 19 child                       | Renders                                                                | [React 19.0.0 changelog](https://raw.githubusercontent.com/facebook/react/main/CHANGELOG.md), #24580       |
| Drizzle `bigint({ mode: "bigint" })` | Returns `bigint`                                                       | `drizzle-orm@0.45.2/pg-core/columns/bigint.js:46-48`                                                       |
| Drizzle `sum()`, `db.execute` rows   | Strings; `sql<bigint>` is a type label only                            | `drizzle-orm@0.45.2/sql/functions/aggregate.js:16-18`, `sql/sql.js:52`, `node-postgres/session.js:105-115` |

Payload for 1,000 rows with six money fields: decimal strings are 189 KB raw
and 57 KB gzipped; `bigint` is 328 KB and 71 KB. Each money field costs 23 more
bytes raw and 2.4 more gzipped, all in the `meta` path. Decoding took about
2.1 ms either way in Bun.

Traps that remain with `bigint`:

- `JSON.stringify` throws. Audit metadata is jsonb written by a
  fire-and-forget insert, so a `bigint` there would lose the audit row.
- React's development-only performance track stringifies changed `bigint[]`
  props and throws ([#35004](https://github.com/facebook/react/issues/35004);
  the fix is not in 19.2.8). Charts should receive numbers.
- `Number(paise)` never throws. A `Number(x)` missed in an export is a silent
  100× error.

### Representation

| Option                                        | Size (gzip)                                                             | Exactness                                                          | Verdict                     |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------- |
| `bigint` paise and four helpers               | about 0.5 KB                                                            | Exact; misuse throws (`1n + 1`, `Math.max(1n)`, `JSON.stringify`)  | Keep                        |
| `number` paise                                | 0                                                                       | Exact for sums below 2^53 (₹90 lakh crore); products fail silently | Reject                      |
| dinero.js 2.0.2                               | 2.3–5.3 KB ([bundlephobia](https://bundlephobia.com/package/dinero.js)) | Exact                                                              | More API, no gain           |
| big.js 7.0.1, decimal.js 10.6.0               | 3.0 KB, 12.7 KB                                                         | Exact decimal                                                      | Not needed for two decimals |
| currency.js 2.0.4                             | 1.1 KB                                                                  | Floats; `currency(-0.125)` gives `-0.12`                           | Reject                      |
| [pesa](https://github.com/frappe/pesa) 1.1.13 | 3.5 KB                                                                  | `bigint` at six places, banker's rounding by default               | Dormant since December 2022 |

`number` failures reproduced locally:

- `999999999999999 * 1800` is off by 8 and prints the same leading digits.
- Allocating a ₹1,00,000.01 discount over a ₹2,00,00,000.02 invoice gives a
  ₹1,00,00,000.01 line 5,000,000 paise instead of the exact half-up 5,000,001.
  One million random cases at that scale found no error, so tests would not
  catch it.
- `Math.round(-2.5)` is `-2`, which is wrong for credit notes.

`bigint` sums ran 1.1–4.9× slower than `number` and half-up tax 1.8–7.8×
slower, but every operation took under 0.12 µs
([V8 BigInt design](https://v8.dev/blog/bigint)).

What others do:

- [Stripe](https://docs.stripe.com/currencies) and
  [Razorpay](https://razorpay.com/docs/api/orders/create/) take integer minor
  units.
- [Tally](https://help.tallysolutions.com/developer-reference/tally-definition-language/what-are-data-types-operators-and-expressions-in-tdl/)
  documents an amount range of ±92,233,720,368,547.7580, which is 2^63/10^5; by
  inference, a 64-bit fixed-point integer.
- [ERPNext](https://github.com/frappe/frappe/blob/develop/frappe/database/postgres/database.py)
  stores `decimal(21,9)`.
  [Frappe Books](https://github.com/frappe/books/blob/master/package.json) uses
  `pesa` over text columns.
- [Midday](https://github.com/midday-ai/midday/blob/main/packages/db/src/schema.ts)
  stores `numeric(10,2)`, reads it with `parseFloat`, and builds a formatter on
  every call
  ([format.ts](https://github.com/midday-ai/midday/blob/main/packages/utils/src/format.ts)).
- [Zoho Books](https://www.zoho.com/books/api/v3/invoices/) documents `double`
  amounts.

Platform status:
[Decimal](https://github.com/tc39/proposals/blob/main/stage-1-proposals.md) is
at TC39 Stage 1. [Amount](https://github.com/tc39/proposal-amount) is at Stage 2,
does no arithmetic, and its polyfill is not for production. Postgres calls
`numeric` "very slow compared to the integer types"
([docs](https://www.postgresql.org/docs/current/datatype-numeric.html)), and
`sum(bigint)` returns `numeric`
([docs](https://www.postgresql.org/docs/current/functions-aggregate.html)).

### Display

- `Intl.NumberFormat.prototype.format` accepts a string and formats "the exact
  value that the string represents"
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/format),
  ECMA-402 2023). Support: Chrome 106, Firefox 116, Safari 15.4, Node 19,
  Bun 1.0 ([caniuse](https://caniuse.com/mdn-javascript_builtins_intl_numberformat_format_number_parameter-string_decimal)).
  An older engine converts the string to a Number, which is still exact to 15
  digits. Vite's default targets include Firefox 114 and 115.
- ``format(`${paise}E-2`)`` matched the exact decimal-slice path for 300,000
  random values of 1–20 digits and for 0, ±1, ±999,999,999,999,999, 2^53 + 1
  and 10^30 + 7. Bun 1.4.0 and Node 24.21 printed identical text: `₹0.00`,
  `-₹0.05`, `₹12,34,56,789.90`. The survey also found identical en-IN output in
  Deno 2.9 and macOS 26 JavaScriptCore. SpiderMonkey was not tested.
- TypeScript 7.0.2 declares the string overload in `lib.es2023.intl.d.ts` as
  `Intl.StringNumericLiteral`. A template built from a `bigint` widens to
  `string`, so the call needs `ES2023.Intl` in `lib` and one assertion.
  `apps/web/tsconfig.json` uses ES2022, which is why
  `apps/web/src/lib/money.ts:26` casts through `unknown`.
- Building a formatter and formatting once costs 27–31 µs. A reused formatter
  formats in about 0.5 µs for a number and 0.7 µs for a string or `bigint`.
  Reuse matters 40–60×; the input type matters 1.4×.

### Benchmarks

Bun 1.4.0 (ICU 78.1) and Node 24.21.0 (V8 13.6, ICU 78.3) on an Apple M1.
Each figure is the median of five mitata rounds after warmup.

Formatting one amount, in nanoseconds:

| Approach                                           | Bun   | Node |
| -------------------------------------------------- | ----- | ---- |
| Today: decimal string, parse, rebuild string, Intl | 1,131 | 720  |
| Intl on `` `${paise}E-2` ``                        | 757   | 465  |
| Intl on `Number(paise) / 100`                      | 636   | 425  |
| Hand-written en-IN grouping                        | 229   | 182  |

- Every approach printed identical text for 100,000 random values and the edge
  cases, and the outputs hashed the same in both runtimes. A negative prints
  as `-₹123.45`.
- Today's path throws a RangeError from 10^15 paise upward, because it
  re-parses through the 13-digit input cap; report totals have no cap.
- `Number(paise) / 100` stays exact up to 7,036,874,417,766,400 paise, seven
  times the input cap.

Parsing: today's `parseMoney` takes 134–155 ns. The fastest correct
alternative saves 12–16%. `BigInt(text.replace(".", ""))` is wrong for 66% of
valid input.

Arithmetic per element: a `bigint` sum costs 3.8–7.9 ns against about 1 ns for
`number`, and half-up tax 22–79 ns against 2–5 ns. A 20-line invoice needs
1.2–4 µs of `bigint` work. `number` tax first goes wrong at a taxable value of
₹400,319,966,878.25, inside the cap. `number` allocation errors start at
11-digit subtotals (5 per million cases) and reach 11,225 per million at 15
digits.

Wire, 1,000 rows with six money fields, from the server's `bigint` rows to the
client's decoded value, in microseconds:

| Wire value     | Raw bytes | Gzip bytes | Bun   | Node  |
| -------------- | --------- | ---------- | ----- | ----- |
| Decimal string | 260,229   | 57,998     | 1,467 | 1,999 |
| `bigint`       | 418,729   | 71,464     | 2,521 | 3,883 |
| `number`       | 238,211   | 55,708     | 845   | 1,648 |

End to end for that report in Node, today's path (server formatting, wire,
client re-parse and Intl) costs about 6.3 ms. `bigint` on the wire with the
`E-2` formatter costs about 6.7 ms, and with hand-written grouping about
5.0 ms. A 50-row page stays under 0.3 ms on every path. Runtime does not decide
between them; code does.

## What this proves and does not prove

It proves that the installed stack carries `bigint` from Postgres to React
without a custom serializer. It proves that one reused Intl formatter, given an
exponent string, prints exact INR text in Bun and Node. It also proves that
`number` paise fails silently in the tax and allocation math this app does.

It does not prove SSR hydration of a `bigint` field in the running app: the
probe ran in isolation, and TanStack's
[SSR guide](https://github.com/tanstack/router/blob/main/docs/router/guide/ssr.md)
still says BigInt "may need a custom serializer". It does not cover
SpiderMonkey's en-IN output, browser decode time for large reports, or runtime
reliance on money strings that neither types nor search reveal.

## What this means for us

| Place       | Representation                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Postgres    | `bigint` paise, unchanged; `sum()` cast to `bigint` and read with `BigInt`                        |
| Server      | `bigint` paise; every division through `divideHalfUp`                                             |
| Wire output | `bigint` over `/rpc`                                                                              |
| Wire input  | Typed rupees as text, parsed once by the shared `money` fragment; echoed server values `bigint`   |
| Client      | `bigint` paise; shared pure functions run unchanged, as client-patterns requires for `computeTax` |
| Display     | `formatMoney(paise)`, one INR formatter                                                           |
| Plain text  | `toDecimal(paise)` for form pre-fill, audit metadata and errors                                   |
| XLSX        | `Number(paise) / 100`                                                                             |

The same change must update accounting-core architecture call 2 and the slice 1
interface, the Billing ledger section of `docs/architecture.md`, and
`docs/design.md` section 13.

Legacy code carries almost every call site. Changing the helpers without shims
touches 27 procedures, 24 web files, five export routes, and tests with 49
direct decimal-string assertions. Many of the several hundred decimal literals
in tests are inputs, which stay text.

## Next falsification

- Render one `bigint` output through an SSR loader in the running app and
  hydrate it without a mismatch.
- Open the largest report in Firefox ESR and Safari and compare totals with
  database sums.
- After the change, search export and chart code for `Number(` next to money;
  any survivor is a silent 100× error.

## Sources

- oRPC: [RPC protocol](https://github.com/dinwwwh/orpc/blob/main/apps/content/docs/rpc/protocol.mdx),
  [OpenAPI serializer](https://github.com/dinwwwh/orpc/blob/main/apps/content/docs/openapi/serializer.mdx),
  [TanStack Query integration](https://orpc.dev/docs/integrations/tanstack-query)
- React: [19.0.0 changelog](https://raw.githubusercontent.com/facebook/react/main/CHANGELOG.md),
  [#35004](https://github.com/facebook/react/issues/35004),
  [#35648](https://github.com/facebook/react/pull/35648)
- Intl:
  [MDN `format`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/format),
  [NumberFormat v3](https://github.com/tc39/proposal-intl-numberformat-v3),
  [compat data](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Intl/NumberFormat.json),
  [Bun #6193](https://github.com/oven-sh/bun/issues/6193)
- BigInt: [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt),
  [V8](https://v8.dev/blog/bigint)
- Libraries: bundlephobia for
  [dinero.js](https://bundlephobia.com/package/dinero.js),
  [big.js](https://bundlephobia.com/package/big.js),
  [decimal.js](https://bundlephobia.com/package/decimal.js),
  [currency.js](https://bundlephobia.com/package/currency.js),
  [pesa](https://bundlephobia.com/package/pesa)
- Postgres: [numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html),
  [aggregates](https://www.postgresql.org/docs/current/functions-aggregate.html),
  [Crunchy Data](https://www.crunchydata.com/blog/working-with-money-in-postgres)
- TC39: [Stage 1 list](https://github.com/tc39/proposals/blob/main/stage-1-proposals.md),
  [Amount](https://github.com/tc39/proposal-amount)
- TanStack: [SSR guide](https://github.com/tanstack/router/blob/main/docs/router/guide/ssr.md)
