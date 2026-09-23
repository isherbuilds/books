# Midday timezone patterns and our offset seam

For planned recurring invoices, see the [recurrence comparison](./midday-recurring-invoices-timezones-2026-09-23.md). It extends this note's conclusion for a new use case; the current offset seam remains unchanged.

## Question

Which timezone patterns from Midday should we adopt, if any, for organization-local dates and wall-clock conversion?

## Answer

**Adopt `@date-fns/tz`'s `tzOffset`; defer a broader date-fns/TZDate migration. This is not a rejection of either library.** `tzOffset` replaces the custom offset extractor without changing the organization-time, date-only, or validation contracts. No current recurrence or date-arithmetic requirement justifies replacing cached `Intl` formatting and date strings ([official package docs](https://github.com/date-fns/tz#tzoffset); `apps/web/src/lib/org-datetime.ts`; `apps/web/src/lib/date-presets.ts`).

**Corrected rationale:** a bare `TZDate` constructor normalizes a gap, but a round-trip guard can reject it; normalization alone does not rule out the library. A guarded constructor was therefore tested below. It changed ambiguous-fold instants across host zones in the sampled runtime, so that candidate is not a behavior-preserving replacement ([constructor API and tests](https://github.com/date-fns/tz#tzdate); `tests/unit/org-datetime.test.ts:20-35`).

## Evidence

### The narrow API matches the narrow job

The official implementation defines `tzOffset(timeZone, date)` as the UTC offset in minutes, with the sign mirrored from `Date#getTimezoneOffset`: UTC+8 returns `480`. It reads runtime timezone data through `Intl.DateTimeFormat`, caches formatters and parsed offsets, and returns minutes ([official source](https://github.com/date-fns/date-fns/blob/main/pkgs/tz/src/tzOffset/index.ts); installed `node_modules/.bun/@date-fns+tz@1.5.0/node_modules/@date-fns/tz/tzOffset/index.js:1-53`). The package documentation says its utilities can be used without date-fns ([official README](https://github.com/date-fns/tz#tzoffset)).

Our implementation now calls `tzOffset(timeZone, instant) * 60_000` at the same two points where the former 28-line custom offset helper was called. It still makes an initial UTC-shaped guess, recomputes after correction, formats the result back in the organization zone, and throws `RangeError` when the wall clock does not round-trip (`apps/web/src/lib/org-datetime.ts:68-99`). Cached `Intl.DateTimeFormat` display behavior and UTC-pinned date-only formatting are unchanged (`apps/web/src/lib/org-datetime.ts:12-29,31-65`).

The runtime comparison exercised 63 cases under each of `TZ=UTC`, `TZ=America/Los_Angeles`, and `TZ=Asia/Tokyo`: 189 comparisons produced equal ISO instants or equal `RangeError` outcomes between the old helper and `tzOffset`. The targets were UTC, Kolkata, New York, Helsinki, Lord Howe, Apia, and Chatham, including March/October gaps, a November fold, Apia's skipped 2011 day, and a 1900 historical offset. The existing focused date run also passed all 10 tests; the durable assertions include Kolkata's day boundary, New York's earlier fold occurrence and post-fold time, spring-gap rejection, and invalid-zone rejection (`tests/unit/org-datetime.test.ts:9-35`; `tests/unit/business-date.test.ts:5-11`).

The built app also passed the actual exception form flow with browser timezone `Asia/Tokyo` and organization timezone `America/New_York`: `2027-03-14T02:30` was rejected as nonexistent; `2026-11-01T01:30` was accepted and persisted as `2026-11-01T05:30:00Z`. The page displayed `1 Nov 2026, 1:30 am`; grant and revoke both completed.

### Follow-up: guarded constructor, not a naïve replacement

On Bun 1.4.2 with `@date-fns/tz` 1.5.0, a throwaway comparison parsed the five numeric wall-clock fields, constructed `new TZDateMini(year, month - 1, day, hour, minute, 0, 0, zone)`, compared its local getters back to the input, threw `RangeError` on a mismatch, and returned a plain `Date` from its timestamp. This retains gap rejection instead of silently normalizing operator input.

The probe compared 13 wall clocks in each of the seven zones above under three host zones: 273 comparisons, 271 equal results and two mismatches. UTC-hosted comparisons all matched.

| Host zone           | Organization wall clock            | Existing converter | Guarded constructor |
| ------------------- | ---------------------------------- | ------------------ | ------------------- |
| America/Los_Angeles | America/New_York, 2026-11-01 01:30 | 2026-11-01 05:30Z  | 2026-11-01 06:30Z   |
| Asia/Tokyo          | Europe/Helsinki, 2026-10-25 03:30  | 2026-10-25 01:30Z  | 2026-10-25 00:30Z   |

The New York row changes an existing asserted contract. The Helsinki row also shows that the current converter is **not** a universal “choose the earlier fold” policy: its existing outcome there is the later occurrence. No new uniform fold policy was invented in this patch.

The complete probe wall-clock inputs were `1900-01-01T12:34`, `2026-01-15T12:34`, `2026-03-08T02:30`, `2026-03-29T03:30`, `2026-04-05T01:45`, `2026-04-05T03:00`, `2026-10-04T02:15`, `2026-10-25T03:30`, `2026-11-01T01:30`, `2026-11-01T03:00`, `2011-12-30T12:00`, `2026-12-31T23:59`, and `2026-09-27T03:00`. This method and result are the experimental evidence; the candidate was not shipped.

### Dependency state

At Midday commit [`51587319f26a0ffaa9dfccab1920373cb65689b7`](https://github.com/midday-ai/midday/commit/51587319f26a0ffaa9dfccab1920373cb65689b7), its catalog requested `date-fns ^4.1.0` and `@date-fns/tz ^1.4.1`, resolving 4.1.0 and 1.4.1 respectively ([package pin](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/package.json#L28-L42); [lock entries](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/bun.lock#L1021-L1023), [timezone lock entry](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/bun.lock#L2771)).

Locally, `react-day-picker@10.0.1` already brought `@date-fns/tz ^1.4.1` and `date-fns ^4.1.0`; the lock resolved `@date-fns/tz@1.5.0` and `date-fns@4.4.0` before this direct use (`bun.lock:461,1417,2129`). The web app now directly declares only `@date-fns/tz ^1.5.0`, making its source import explicit (`apps/web/package.json:12-18`; `bun.lock:78-86`). The package is MIT licensed ([official license](https://github.com/date-fns/date-fns/blob/main/pkgs/tz/LICENSE.md)); no Midday implementation was copied.

### Midday is useful precedent, not a template

- **Calendar-only dates:** Midday constructs UTC `TZDate` values for calendar calculations ([date utility](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/utils/date.ts#L1-L22); [calendar hook](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/hooks/use-calendar-dates.ts#L1-L29)). We already retain a named day with UTC-pinned strings and formatting, so conversion adds no contract benefit (`apps/web/src/lib/org-datetime.ts:46-65`).
- **Timezone ownership:** Midday detects and stores a user's browser IANA zone, with override and auto-sync ([detector](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/timezone-detector.tsx#L30-L55); [settings UI](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/change-timezone.tsx#L27-L64)). Our zone belongs to the organization and is supplied by its route loader, so the scopes are not interchangeable (`apps/web/src/lib/org-datetime.ts:102-112`).
- **Recurrence:** Midday uses `tz(timezone)` with date-fns for zone-aware recurring invoice boundaries ([imports and context](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/utils/invoice-recurring.ts#L1-L9), [calculation](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/utils/invoice-recurring.ts#L114-L127)). No equivalent recurrence requirement was found in the inspected local targets. Midday's client preview itself labels its recurrence calculation simplified and without timezone support ([client recurrence](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/invoice/src/utils/recurring.ts#L293-L305)).
- **Presets:** Midday's presets use ordinary date-fns operations from `new Date()`, therefore the device/system clock ([preset source](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/utils/date-presets.ts#L1-L75)). Our presets intentionally operate on organization-business-date strings, so copying that approach would change timezone ownership rather than simplify it (`apps/web/src/lib/date-presets.ts:1-3,24-59`).

No Midday `tzOffset` use was established, and no representative Midday wall-clock gap/fold policy was found. That absence is search-limited: unauthenticated GitHub code search returned HTTP 401 / required sign-in, so it is not proof across the entire repository ([API search](https://api.github.com/search/code?q=repo%3Amidday-ai%2Fmidday+tzOffset); [web search](https://github.com/search?q=repo%3Amidday-ai%2Fmidday+tzOffset&type=code)).

## What this proves / does not prove

The exact-version runtime probe provides strong evidence that the narrow substitution preserves the sampled conversion outcomes across positive, negative, fractional, historical, gap, fold, and skipped-day offsets. The focused tests prove the currently asserted organization-date and wall-clock contracts still pass (`tests/unit/org-datetime.test.ts:9-35`; `tests/unit/business-date.test.ts:5-11`). Official source establishes the return unit and sign, and current code shows the existing validation remains around it ([official source](https://github.com/date-fns/date-fns/blob/main/pkgs/tz/src/tzOffset/index.ts); `apps/web/src/lib/org-datetime.ts:75-99`).

Neither finite probe proves behavior for every IANA zone, runtime, or future tzdata revision. No latency or bundle-size gain is claimed. Gap normalization is addressable by validation; the guarded candidate's observed host-dependent fold differences are the concrete reason not to substitute it now. This is not proof that no correct implementation can use `TZDate` or date-fns.

## What this means for us

Keep the direct `@date-fns/tz` dependency and the narrow `tzOffset` cutover. Retain cached `Intl` display, UTC/date-only arithmetic, two-pass resolution, and round-trip refusal. Broader date-fns use is welcome when it replaces real calendar/recurrence work without changing organization ownership or wall-clock semantics; copying Midday's device-clock presets would not do that (`apps/web/src/lib/org-datetime.ts`; `apps/web/src/lib/date-presets.ts`).

## Next falsification

Reconsider a broader implementation when a concrete simplification is proposed, organization-zone recurrence is introduced, or the timezone package is updated. Test guarded conversion under multiple host zones, including both mismatch rows above, and specify ambiguous-fold policy before changing it. Rerun the existing organization-date tests plus gap, skipped-day, fractional, and historical offsets. Equal output is required for a behavior-preserving refactor; an intentional policy change needs its own acceptance criteria.

## Sources

- [`@date-fns/tz` documentation, including `tzOffset`](https://github.com/date-fns/tz#tzoffset)
- [`tzOffset` current official source](https://github.com/date-fns/date-fns/blob/main/pkgs/tz/src/tzOffset/index.ts)
- [`@date-fns/tz` MIT license](https://github.com/date-fns/date-fns/blob/main/pkgs/tz/LICENSE.md)
- [Midday pinned commit `51587319f26a0ffaa9dfccab1920373cb65689b7`](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7)
- Local implementation and dependency evidence: `apps/web/src/lib/org-datetime.ts`, `apps/web/src/lib/date-presets.ts`, `apps/web/package.json`, `bun.lock`
- Local durable behavior evidence: `tests/unit/org-datetime.test.ts`, `tests/unit/business-date.test.ts`
