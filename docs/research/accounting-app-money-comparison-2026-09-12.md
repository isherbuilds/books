# Money handling in accounting applications

## Question

How do ERPNext, Frappe Books, Midday, Odoo and GnuCash store, parse, calculate,
round and display money? What should Accly adopt for INR, USD and other currencies?

Research date: 2026-09-12. This is source research, not an implementation or a
change to the INR-only contract. It extends the
[existing money investigation](./money-handling-2026-09-11.md) with external
comparisons. Its recommendation remains: keep exact integer posted amounts.

## Answer

There is no single industry representation. ERPNext and Odoo combine decimal SQL
storage with float arithmetic. Frappe Books uses scaled bigint arithmetic with
extra precision and SQLite text storage. Midday's inspected invoice path uses
JavaScript numbers. GnuCash uses rational numbers. The evidence below separates
database types from runtime types; neither a decimal column nor a bigint library
proves exactness through every boundary.

**Recommendation for Accly:** retain bigint minor units for posted money. Keep
input validation, arithmetic rounding and display separate. When fractional unit
prices, quantities or FX are required, give those intermediate values an explicit
precision contract. A decimal library can be justified there; foreign currency
symbols alone do not justify replacing the money core. This is an architectural
inference from the comparisons, not a benchmark result.

| Application    | Observed representation                           | Main advantage, inferred                                   | Main cost or limitation                                    |
| -------------- | ------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| ERPNext/Frappe | SQL decimal; Python/JS floats [E1][E1] [E2][E2]   | Broad configurable precision and multiple currency amounts | Rounding discipline and float limits remain                |
| Frappe Books   | SQLite text; Pesa scaled bigint [B1][B1] [B2][B2] | Retains fractional intermediate values                     | More scale decisions; some display/report paths use floats |
| Midday         | SQL numeric; JS numbers [M1][M1] [M2][M2]         | Small, familiar web calculation path                       | Storage precision does not protect runtime arithmetic      |
| Odoo           | SQL numeric; Python floats [O1][O1]               | Currency-owned precision and conversion                    | Requires currency-aware float rounding/comparison          |
| GnuCash        | Integer numerator/denominator [G1][G1]            | Exact fractions, including non-decimal fractions           | Denominator, rounding and overflow machinery               |

## Evidence

### ERPNext and Frappe Framework

Pinned ERPNext **16.34.2**, commit `4048fb70e14d1843956fcdabb7c3cca75a1cbcdd`,
and Frappe **16.33.1**, commit `988e54f3c4c291e2077a83809663f123731abe76`,
on their version-16 branches. These are the inspected versions, not a claim
about every supported release. [ERPNext version][E0] [Frappe version][E0a]

- Frappe maps Currency to `decimal(21,9)`. Its MariaDB decoder converts decimal
  results to Python float; PostgreSQL registers a corresponding decimal-to-float
  adapter. [Database mappings and adapters][E1] [PostgreSQL adapter][E2]
- ERPNext multiplies rate by quantity and calls `flt` with the amount field's
  precision. Base-currency values multiply by the conversion rate and round to
  their own field precision. [Invoice calculation][E3]
- Server `flt` parses through Python float and returns zero on invalid input.
  Rounding supports commercial and banker's modes. Browser parsing also uses
  floats; currency formatting applies configured separators, precision and
  symbols. [Server parsing and rounding][E4] [Browser formatting][E5]
- GL entries distinguish company, account, transaction and reporting currency
  amounts. Transaction/reporting exchange rates have their own precision.
  This is real currency accounting context, not merely a symbol option. [GL schema][E6]

**Pros — inference:** field precision and separate base/foreign amounts fit a broad
ERP with fractional prices and conversion. Explicit precision ownership is useful.
**Cons — inference:** SQL's nine decimal places are not an end-to-end exactness
guarantee. Copying its float and invalid-to-zero paths would conflict with Accly's
strict money boundary. Its configuration breadth would add little to INR-only work.

### Frappe Books

Pinned Books **0.37.0**, commit `a79a1e3b03f424805ad094e2fd8731d04f84d36f`.
Its lockfile selects **Pesa 1.1.12**; inspected Pesa commit
`152909e237f025e6ad6edc770c39166a4128ad3d`. [Package][B0] [Lockfile][B0a]

- Currency fields use SQLite text. The converter stores `Money.store` decimal
  strings and reconstructs Pesa on reads. Pesa holds a bigint and a decimal
  precision. This differs from storing integer cents or paise. [Storage][B1]
  [Converter][B1a] [Pesa arithmetic][B2]
- Books defaults to **11 internal decimal places and two display places**.
  Its money factory receives those settings separately. Eleven places represent
  fractions of a major currency unit, not eleven digits of integer paise.
  [Defaults][B3] [Configuration][B3a]
- Pesa parses decimal digits into scaled integers. Display rounding defaults to
  half-even. Division truncates at the internal scale; multiplication and parsing
  have separate precision handling. Therefore, describing every operation as
  half-even would be wrong. [Parser][B4] [Arithmetic][B2] [Rounding default][B4a]
- Some boundaries lose that representation: display converts the rounded text to
  a JS float before Intl; bespoke SQL reports cast text to SQLite `REAL`; invoice
  exchange-rate acquisition rounds a numeric rate to two decimals.
  [Display][B5] [Report SQL][B6] [Invoice FX][B7]
- The form helper substitutes zero when Pesa parsing fails. That is a fallback
  policy, not a property required by bigint arithmetic. [Input fallback][B8]

**Pros — inference:** extra internal precision can preserve intermediate values
before posting. It is the closest reference here for exact JS arithmetic.
**Cons — inference:** calculation scale, storage scale and display scale become
separate decisions. Its float exits, two-decimal FX rate and zero fallback are
not patterns to copy. PostgreSQL already supports exact integer/numeric columns;
SQLite text storage is not a reason to change Accly's database representation.

### Midday

Pinned `midday-ai/midday` main commit
`51587319f26a0ffaa9dfccab1920373cb65689b7`. Claims concern the inspected invoice,
formatting and FX paths, not every module or the hosted deployment.

- `numericCasted` reads PostgreSQL numeric through `Number.parseFloat`. Invoice
  totals use `numeric(10,2)`; line items use JSONB. The shared total function
  multiplies/sums JS numbers without explicit rounding inside the helper.
  [Adapter][M1] [Invoice schema][M1a] [Calculation][M2]
- Amount input consumes `react-number-format`'s `floatValue`, defaults an empty
  value to zero, and defaults input scale to two decimals. Display uses Intl,
  with separate fallbacks for non-finite amounts and formatting errors.
  [Input][M3] [Display][M4]
- Its Stripe helper distinguishes zero-, two- and three-decimal currencies, but
  this is a payment-adapter rule. It does not change the inspected two-decimal
  invoice columns. Worker FX helpers use `rate ?? 1` and round to two decimals;
  a separate invoice summary skips missing rates. [Stripe units][M5]
  [Worker FX][M6] [Invoice summary][M7]

The researcher executed the pinned total helper: price `0.1`, quantity `3`
produces `0.30000000000000004`. This establishes its arithmetic representation;
it does not establish an incorrect posted invoice or customer-visible incident.
The helper's precision test uses approximate equality. [Helper tests][M8]

**Pros — inference:** one shared calculation owner and thin input integration are
easy to follow. Native locale formatting is appropriate.
**Cons — inference:** decimal SQL storage does not repair float calculations.
Input, database, display and payment scale need a common contract for a currency
such as KWD. Missing-rate and invalid-value fallbacks are unsuitable for Accly.
Midday is useful UI prior art, not evidence to weaken the exact-money invariant.

### Odoo

Pinned Odoo **19.0** branch commit
`c50a4e0513e5247f1b680ccbb5c0d27795a10b55`.

- `Monetary` is a Python float field backed by PostgreSQL numeric. Currency
  metadata owns its precision and symbol; cache conversion calls float and
  currency rounding. [Monetary field][O1]
- Currency methods own rounding, comparison, zero checks and dated conversion.
  Conversion multiplies by a rate and optionally rounds in the target currency.
  The shared float helper compensates for binary representation errors and
  defaults to half-up. [Currency methods][O2] [Float helpers][O3]
- Browser parsing normalizes locale separators into JS numbers. Monetary display
  resolves a currency and delegates to currency formatting. [Parser][O4]
  [Formatter][O5]
- Ledger debit/credit/balance reference company currency; `amount_currency` has
  the foreign amount and its own currency reference. [Ledger fields][O6]

**Pros — inference:** currency ownership is explicit, and base amounts are separate
from transaction amounts. These are valuable models for future FX work.
**Cons — inference:** float arithmetic requires the surrounding precision helpers.
Adopting that machinery would be a regression in simplicity for our existing
integer-money model. Its source does not prove this approach faster than ours.

### GnuCash

Inspected the **v5 manual** and **STABLE numeric API documentation** on the research
date; unlike the repositories above, the API page is mutable and not commit-pinned.

GnuCash's numeric API represents values with a 64-bit numerator and denominator.
It supports non-decimal fractions and explicit denominator/rounding policies.
Arithmetic exposes overflow and remainder errors. Its account/report currency
settings and exchange-rate records are distinct concepts. [Numeric API][G1]
[Currency workflow][G2]

**Pros — inference:** rational arithmetic is a strong fit for exact ratios and
fractional commodities. **Cons — inference:** denominator normalization, overflow
handling and decimal output add machinery. Accly has no demonstrated need for a
general rational-number subsystem. This was a conceptual comparison; localized
GUI parsing and storage backend implementations were not audited.

## What this proves / does not prove

- The pinned code proves the stated representations and selected boundaries.
  It does not prove an application's entire ledger correct or incorrect.
- No full application was run. No comparative throughput, memory, database or UI
  benchmark was performed. There is no evidence here to rank these products by
  speed. PostgreSQL documents integer and numeric storage/performance trade-offs,
  but that is not an Accly workload measurement. [PostgreSQL numeric types][P1]
- This research does not determine tax-law rounding policy, operational adoption,
  or the internals of closed-source products such as Tally, Xero or QuickBooks.
- Several float/fallback boundaries were found in source. They are not presented
  as demonstrated production incidents. Multi-currency feature support also does
  not prove every input/report handles every currency scale consistently.

## What this means for us

The current owner is [core/money.ts](../../packages/api/src/core/money.ts): decimal
input to bigint paise, explicit integer division, plain decimal output, and Intl
display. [Accounting core call 2](../specs/accounting-core.md) keeps INR-only money
and defers multi-currency. Research does not supersede that decision.

Recommended choices, inferred from the source comparison:

1. **Keep posted amounts as bigint minor units.** Keep input caps/sign rules in
   input validation. Computed totals must not inherit a single-input size limit.
   Bound stored values against PostgreSQL bigint as well: JS bigint is arbitrary
   precision, PostgreSQL bigint is signed 64-bit. [Current parser][A1] [SQL range][P1]
2. **Separate amount precision from rate/quantity precision.** USD cents need two
   places, but an FX rate or unit price may need more. For fractional pricing or
   FX, choose scaled integers or one decimal library for intermediates, then round
   at the named line/document/posting boundary. Do not round exchange rates to
   two places merely because USD has cents. Books and ERPNext show why these
   concepts exist, not which policy Accly must use. [B3][B3] [E3][E3]
3. **Use one explicit currency scale when support expands.** A bounded catalog
   could define INR/USD at two places, JPY at zero and KWD at three. The same
   scale must govern parsing, persisted minor units and output. Locale controls
   grouping and language, not denomination or FX. A Bun 1.4.0 probe with `1234n`
   and exact decimal strings displayed INR/USD `12.34`, JPY `1,234`, and KWD
   `1.234`. Native Intl accepts exact numeric strings. [Intl specification][P2]
4. **Keep strict input and useful display.** Parse a documented decimal grammar;
   reject malformed text and excess precision rather than silently substituting
   zero. Localized entry can be added deliberately, but ambiguous separator
   fallbacks are not required for localized display. Never parse display text
   back into the ledger. [Current boundary][A1] [Native formatting][P2]
5. **Treat FX as accounting work.** If foreign transactions become required,
   specify transaction/base amounts, currencies, dated rate evidence, rounding,
   settlement differences and missing-rate behavior. Do not change only the
   formatter signature or copy `rate ?? 1`. Odoo/ERPNext provide useful ownership
   examples. [O6][O6] [E6][E6] [M6][M6]

No new Money class, global provider or currency framework is justified today.
No benchmark in this investigation justifies changing representation for speed.
The natural next step is a scoped spec decision if multi-currency or fractional
pricing is now intended. Otherwise, fix the existing parsing boundary within the
current contract. This note authorizes neither change.

## Next falsification

Before changing the contract, run one focused workflow with:

- INR/USD, JPY and KWD inputs, including excess fractional digits and malformed text.
- Large totals above the per-input bound, plus stored-value overflow rejection.
- Positive/negative rounding ties and fractional quantity multiplied by price.
- FX rates below `0.01`, missing rates and invoice/payment dates with different rates.
- The same posted facts through database, RPC/SSR, screen, PDF and export.

Specify expected rounding and currency amounts first. Then compare the current
bigint path with a decimal alternative under the same workload only if the
requirements expose a real limitation. Successful formatting alone cannot prove
posting, FX or allocation correctness.

## Sources

All repository links below are immutable; documentation pages were accessed on
2026-09-12. Pros/cons and recommendations above are explicitly labelled inference.

[E0]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/__init__.py#L9
[E0a]: https://github.com/frappe/frappe/blob/988e54f3c4c291e2077a83809663f123731abe76/frappe/__init__.py#L58
[E1]: https://github.com/frappe/frappe/blob/988e54f3c4c291e2077a83809663f123731abe76/frappe/database/mariadb/database.py#L163-L180
[E2]: https://github.com/frappe/frappe/blob/988e54f3c4c291e2077a83809663f123731abe76/frappe/database/postgres/database.py#L33-L39
[E3]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/controllers/taxes_and_totals.py#L226-L259
[E4]: https://github.com/frappe/frappe/blob/988e54f3c4c291e2077a83809663f123731abe76/frappe/utils/data.py#L1121-L1335
[E5]: https://github.com/frappe/frappe/blob/988e54f3c4c291e2077a83809663f123731abe76/frappe/public/js/frappe/utils/number_format.js#L8-L172
[E6]: https://github.com/frappe/erpnext/blob/4048fb70e14d1843956fcdabb7c3cca75a1cbcdd/erpnext/accounts/doctype/gl_entry/gl_entry.json
[B0]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/package.json#L1-L5
[B0a]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/yarn.lock#L4492-L4496
[B1]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/backend/helpers.ts#L7-L14
[B1a]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/fyo/core/converter.ts#L201-L315
[B2]: https://github.com/frappe/pesa/blob/152909e237f025e6ad6edc770c39166a4128ad3d/src/preciseNumber.ts#L19-L83
[B3]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/fyo/utils/consts.ts#L1-L7
[B3a]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/fyo/index.ts#L151-L163
[B4]: https://github.com/frappe/pesa/blob/152909e237f025e6ad6edc770c39166a4128ad3d/src/utils.ts#L1-L55
[B4a]: https://github.com/frappe/pesa/blob/152909e237f025e6ad6edc770c39166a4128ad3d/src/consts.ts#L1-L5
[B5]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/fyo/utils/format.ts#L129-L178
[B6]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/backend/database/bespoke.ts#L43-L138
[B7]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/models/baseModels/Invoice/Invoice.ts#L399-L417
[B8]: https://github.com/frappe/books/blob/a79a1e3b03f424805ad094e2fd8731d04f84d36f/utils/index.ts#L195-L216
[M1]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/schema.ts#L35-L53
[M1a]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/schema.ts#L885-L940
[M2]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/invoice/src/utils/calculate.ts#L1-L63
[M3]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/invoice/amount-input.tsx#L28-L57
[M4]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/utils/format.ts#L24-L74
[M5]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/invoice/src/utils/currency.ts#L18-L161
[M6]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/worker/src/utils/base-currency.ts#L1-L39
[M7]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/queries/invoices.ts#L914-L970
[M8]: https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/invoice/src/utils/calculate.test.ts#L168-L178
[O1]: https://github.com/odoo/odoo/blob/c50a4e0513e5247f1b680ccbb5c0d27795a10b55/odoo/orm/fields_numeric.py#L185-L281
[O2]: https://github.com/odoo/odoo/blob/c50a4e0513e5247f1b680ccbb5c0d27795a10b55/odoo/addons/base/models/res_currency.py#L216-L303
[O3]: https://github.com/odoo/odoo/blob/c50a4e0513e5247f1b680ccbb5c0d27795a10b55/odoo/tools/float_utils.py#L72-L146
[O4]: https://github.com/odoo/odoo/blob/c50a4e0513e5247f1b680ccbb5c0d27795a10b55/addons/web/static/src/views/fields/parsers.js#L88-L108
[O5]: https://github.com/odoo/odoo/blob/c50a4e0513e5247f1b680ccbb5c0d27795a10b55/addons/web/static/src/views/fields/formatters.js#L335-L351
[O6]: https://github.com/odoo/odoo/blob/c50a4e0513e5247f1b680ccbb5c0d27795a10b55/addons/account/models/account_move_line.py#L116-L150
[G1]: https://code.gnucash.org/docs/STABLE/group__Numeric.html
[G2]: https://www.gnucash.org/docs/v5/C/gnucash-guide/currency_manual.html
[P1]: https://www.postgresql.org/docs/18/datatype-numeric.html
[P2]: https://tc39.es/ecma402/#sec-tonintlmathematicalvalue
[A1]: ../../packages/api/src/core/money.ts
