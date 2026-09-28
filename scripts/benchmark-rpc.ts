import { businessDate } from "@accly/api/lib/business-date";
import type { AppRouter } from "@accly/api/routers/index";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

// Times every API read, search, report, export and (opt-in) write against a running
// server, one scenario at a time. Each response is checked before it counts: a wrong
// answer stops the run, so a fast number can never come from a broken query.

const API_URL = process.env.PERF_API_URL ?? "http://127.0.0.1:3100";

const WEB_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3101";

const EMAIL = process.env.PERF_EMAIL;

const PASSWORD = process.env.PERF_PASSWORD;

const ORG_SLUG = process.env.PERF_ORG_SLUG ?? "meridian-traders";

const REQUEST_COUNT = Number(process.env.PERF_RPC_REQUESTS ?? 30);

const WARMUP_COUNT = Number(process.env.PERF_RPC_WARMUP ?? 5);

// Writes post real documents into the fixture, so they run only when asked.
const WRITES = process.env.PERF_WRITES === "1";

const SELECTED = process.env.PERF_SCENARIOS?.split(",").map((name) => name.trim());

if (SELECTED && SELECTED.every((name) => name === "")) {
  throw new Error("PERF_SCENARIOS is empty; unset it to run every scenario");
}

if (!EMAIL || !PASSWORD) {
  throw new Error("Set PERF_EMAIL and PERF_PASSWORD to a benchmark fixture account");
}

for (const [name, value] of [
  ["PERF_RPC_REQUESTS", REQUEST_COUNT],
  ["PERF_RPC_WARMUP", WARMUP_COUNT],
] as const) {
  if (!Number.isInteger(value) || value < 0 || (name === "PERF_RPC_REQUESTS" && value < 1)) {
    throw new Error(`${name} must be a whole number${name === "PERF_RPC_REQUESTS" ? " ≥ 1" : ""}`);
  }
}

type Kind = "read" | "search" | "aggregate" | "report" | "export" | "refusal" | "write";

/** One timed call. It returns a short description of what came back, or throws. */
type Run = () => Promise<string>;

type Scenario = { name: string; route: string; kind: Kind } & (
  | { run: Run }
  /** Untimed setup, such as the document a write settles, that returns the timed call. */
  | { prepare: () => Promise<Run> }
);

type ScenarioReport = {
  scenario: string;
  route: string;
  kind: Kind;
  result: string;
  requests: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  firstMs: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

// A browser's cookie jar: every response's Set-Cookie updates it, so a renewed
// session cache cookie is sent back as a browser would send it.
const jar = new Map<string, string>();

function remember(headers: Headers): void {
  for (const cookie of headers.getSetCookie()) {
    const [pair = "", ...attributes] = cookie.split(";");
    const split = pair.indexOf("=");
    const name = pair.slice(0, split).trim();
    const value = pair.slice(split + 1);
    const expired = attributes.some((attribute) => /^\s*max-age=0$/i.test(attribute));

    if (expired || value === "") jar.delete(name);
    else jar.set(name, value);
  }
}

const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

const signInResponse = await fetch(new URL("/api/auth/sign-in/email", API_URL), {
  method: "POST",
  headers: { "content-type": "application/json", origin: WEB_URL },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});

if (!signInResponse.ok) throw new Error(`Benchmark sign-in failed: ${signInResponse.status}`);

remember(signInResponse.headers);

if (jar.size === 0) throw new Error("Benchmark sign-in returned no session cookie");

const client: RouterClient<AppRouter> = createORPCClient(
  new RPCLink({
    url: `${API_URL}/rpc`,
    headers: () => ({ cookie: cookieHeader(), origin: WEB_URL }),
    fetch: async (request, init) => {
      const response = await fetch(request, init);

      remember(response.headers);

      return response;
    },
  }),
);

const org = { orgSlug: ORG_SLUG };

// A register page: at most `limit` rows, newest first, and a page flag.
function page(
  result: { rows: { id: string }[]; hasMore: boolean },
  expect: { min?: number; max?: number; includes?: string } = {},
): string {
  const { rows } = result;

  check(rows.length <= 25, `a page holds ${rows.length} rows`);
  check(new Set(rows.map((row) => row.id)).size === rows.length, "a page repeats a row");
  check(
    rows.every((row, index) => index === 0 || rows[index - 1]!.id > row.id),
    "a page is not newest first",
  );
  check(
    rows.length >= (expect.min ?? 0),
    `expected at least ${expect.min} rows, got ${rows.length}`,
  );
  check(
    rows.length <= (expect.max ?? 25),
    `expected at most ${expect.max} rows, got ${rows.length}`,
  );
  check(!result.hasMore || rows.length === 25, "hasMore on a short page");

  if (expect.includes) {
    check(
      rows.some((row) => row.id === expect.includes),
      `the page lacks ${expect.includes}`,
    );
  }

  return `${rows.length} rows${result.hasMore ? ", more" : ""}`;
}

// Every row of a search shows the term in a column it returns, unless it matched the
// narration, which registers do not return; at least one must show it.
function searched(rows: readonly object[], term: string): void {
  const needle = term.toLowerCase();

  check(
    rows.length === 0 ||
      rows.some((row) =>
        Object.values(row).some(
          (value) => typeof value === "string" && value.toLowerCase().includes(needle),
        ),
      ),
    `no row of the "${term}" search shows the term`,
  );
}

async function refusal(call: Promise<unknown>, reason: string): Promise<string> {
  try {
    await call;
  } catch (error) {
    const data = error instanceof ORPCError ? error.data : undefined;

    const found =
      typeof data === "object" && data !== null && "reason" in data ? data.reason : null;

    check(found === reason, `expected ${reason}, got ${String(error)}`);

    return reason;
  }

  return fail(`expected ${reason}, but the call succeeded`);
}

function xlsx(file: File): string {
  check(file.size > 1_000, `the workbook is ${file.size} bytes`);

  return `${Math.round(file.size / 1024)} KB`;
}

// ---- Fixture discovery: every id and term comes from the data. ----

const { timeZone } = await client.member.me(org);

const today = businessDate(new Date(), timeZone);

const yearAgo = new Date(`${today}T00:00:00Z`);

yearAgo.setUTCDate(yearAgo.getUTCDate() - 364);

const from = yearAgo.toISOString().slice(0, 10);

const monthStart = `${today.slice(0, 7)}-01`;

const [partyTotals, partyMaster, moneyAccounts, accountList, methods, items] = await Promise.all([
  client.receipt.partyTotals(org),
  client.party.list(org),
  client.account.moneyBalances(org),
  client.account.list(org),
  client.paymentMethod.list(org),
  client.item.list(org),
]);

check(partyTotals.length > 1, "the fixture needs posted receipts from 2 parties");

const byReceived = partyTotals.toSorted((a, b) =>
  a.receivedPaise < b.receivedPaise ? -1 : a.receivedPaise > b.receivedPaise ? 1 : 0,
);

const smallParty = byReceived[0]!;

const busyParty = byReceived.at(-1)!;

const smallPartyName = partyMaster.rows.find((row) => row.id === smallParty.partyId)?.name;

const vendor = partyMaster.rows.find((row) => row.roles.includes("vendor") && row.active);

const moneyAccount = moneyAccounts[0] ?? fail("the fixture needs a cash or bank account");

const method =
  methods.find((row) => row.active && row.accountId === moneyAccount.id) ??
  methods.find((row) => row.active) ??
  fail("the fixture needs an active payment method");

const item = items.find((row) => row.active) ?? fail("the fixture needs an active item");

const taxCode =
  (await client.item.taxRates(org)).at(-1) ?? fail("the fixture needs a GST rate in force");

const expense =
  accountList.find(
    (row) =>
      row.type === "expense" &&
      row.active &&
      !accountList.some((child) => child.parentId === row.id),
  ) ?? fail("the fixture needs an expense posting account");

check(vendor, "the fixture needs an active vendor");

check(smallPartyName, "the small party is missing from the master");

const [
  newestReceipts,
  smallPartyReceipts,
  invoicePage,
  billPage,
  paymentPage,
  notePage,
  journalPage,
] = await Promise.all([
  client.receipt.list(org),
  client.receipt.list({ ...org, partyId: smallParty.partyId }),
  client.invoice.list(org),
  client.bill.list(org),
  client.payment.list(org),
  client.note.list(org),
  client.journal.list(org),
]);

const newestReceipt = newestReceipts.rows[0] ?? fail("the fixture needs receipts");

const oldReceipt = smallPartyReceipts.rows.at(-1) ?? fail("the small party needs a receipt");

const oldNumber = oldReceipt.number ?? fail("the small party's receipt has no number");

// A direct receipt has no party, so the name comes from the newest receipt that has one.
const commonName =
  newestReceipts.rows.find((row) => row.partyName)?.partyName?.split(" ")[0] ??
  fail("no recent receipt names a party");

const invoice = invoicePage.rows[0] ?? fail("the fixture needs invoices");

const bill = billPage.rows[0] ?? fail("the fixture needs bills");

const payment = paymentPage.rows[0] ?? fail("the fixture needs payments");

const note = notePage.rows[0];

const journal = journalPage.rows[0];

const customer = await client.party.get({ ...org, partyId: smallParty.partyId });

// A party name of another organization: a term common elsewhere and absent here.
const otherOrgName = process.env.PERF_OTHER_ORG_TERM;

const inputs = {
  today,
  from,
  smallPartyId: smallParty.partyId,
  busyPartyId: busyParty.partyId,
  oldNumber,
  commonName,
  moneyAccountId: moneyAccount.id,
  otherOrgName: otherOrgName ?? null,
};

// ---- Scenarios, grouped by the route that reads them. ----

let suffix = 0;

const unique = () => `${Date.now().toString(36)}-${(suffix += 1)}`;

const reads: Scenario[] = [
  // Session and settings, read on every org page.
  {
    name: "member_me",
    route: "layout",
    kind: "read",
    run: async () => (await client.member.me(org)).roles.join(","),
  },
  {
    name: "settings_get",
    route: "settings",
    kind: "read",
    run: async () => (await client.settings.get(org)).legalName,
  },
  {
    name: "lock_get",
    route: "settings/locks",
    kind: "read",
    run: async () => `${(await client.lock.get(org)).exceptions.length} exceptions`,
  },
  {
    name: "member_list",
    route: "settings/members",
    kind: "read",
    run: async () => `${(await client.member.list(org)).members.length} members`,
  },
  {
    name: "audit_list",
    route: "settings/audit",
    kind: "read",
    run: async () => `${(await client.audit.list(org)).items.length} rows`,
  },
  {
    name: "file_list",
    route: "settings/files",
    kind: "read",
    run: async () => `${(await client.file.list(org)).items.length} files`,
  },

  // Masters.
  {
    name: "party_list",
    route: "parties",
    kind: "read",
    run: async () => `${(await client.party.list(org)).rows.length} parties`,
  },
  {
    name: "party_list_search",
    route: "parties",
    kind: "search",
    run: async () => {
      const result = await client.party.list({ ...org, q: smallPartyName.slice(0, 4) });

      check(
        result.rows.some((row) => row.id === smallParty.partyId),
        "the party search lacks its party",
      );

      return `${result.rows.length} parties`;
    },
  },
  {
    name: "account_list",
    route: "accounts",
    kind: "read",
    run: async () => `${(await client.account.list(org)).length} accounts`,
  },
  {
    name: "item_list",
    route: "items",
    kind: "read",
    run: async () => `${(await client.item.list(org)).length} items`,
  },
  {
    name: "payment_method_list",
    route: "banking",
    kind: "read",
    run: async () => `${(await client.paymentMethod.list(org)).length} methods`,
  },
  {
    name: "journal_accounts",
    route: "journals/new",
    kind: "read",
    run: async () => `${(await client.journal.accounts(org)).length} accounts`,
  },

  // Balances: Home, Banking and Parties.
  {
    name: "money_balances",
    route: "home, banking",
    kind: "aggregate",
    run: async () => {
      const rows = await client.account.moneyBalances(org);

      check(
        rows.some((row) => row.id === moneyAccount.id),
        "the money account is missing",
      );

      return `${rows.length} accounts`;
    },
  },
  {
    name: "party_balances",
    route: "home, parties",
    kind: "aggregate",
    run: async () => {
      const rows = await client.party.balances(org);

      check(
        rows.some((row) => row.partyId === busyParty.partyId),
        "the busy party has no balance",
      );

      return `${rows.length} parties`;
    },
  },
  {
    name: "receipt_party_totals",
    route: "parties/$id",
    kind: "aggregate",
    run: async () => `${(await client.receipt.partyTotals(org)).length} parties`,
  },

  // Party page tabs.
  {
    name: "party_get",
    route: "parties/$id",
    kind: "read",
    run: async () => (await client.party.get({ ...org, partyId: busyParty.partyId })).name,
  },
  {
    name: "party_ledger_summary",
    route: "parties/$id",
    kind: "aggregate",
    run: async () => {
      const summary = await client.party.ledgerSummary({
        ...org,
        partyId: busyParty.partyId,
        from,
        to: today,
      });

      return `closing ${summary.closingPaise}`;
    },
  },
  {
    name: "party_ledger_lines",
    route: "parties/$id/ledger",
    kind: "read",
    run: async () =>
      `${(await client.party.ledgerLines({ ...org, partyId: busyParty.partyId, from, to: today })).rows.length} lines`,
  },
  {
    name: "party_transactions_busy",
    route: "parties/$id/transactions",
    kind: "read",
    run: async () =>
      page(await client.party.transactions({ ...org, partyId: busyParty.partyId }), { min: 1 }),
  },
  {
    name: "party_transactions_small",
    route: "parties/$id/transactions",
    kind: "read",
    run: async () =>
      page(await client.party.transactions({ ...org, partyId: smallParty.partyId }), { min: 1 }),
  },
  {
    name: "party_open_items",
    route: "receipts/new",
    kind: "read",
    run: async () =>
      `${(await client.party.openItems({ ...org, partyId: busyParty.partyId, side: "receivable" })).rows.length} items`,
  },
  {
    name: "party_open_credits",
    route: "receipts/new",
    kind: "read",
    run: async () =>
      `${(await client.party.openCredits({ ...org, partyId: busyParty.partyId, side: "receivable" })).rows.length} credits`,
  },
  {
    name: "party_statement_small",
    route: "parties/$id (PDF)",
    kind: "report",
    run: async () => {
      const report = await client.party.statement({
        ...org,
        partyId: smallParty.partyId,
        from: monthStart,
        to: today,
      });

      const last = report.lines.at(-1);

      check(
        (last?.balancePaise ?? report.openingPaise) === report.closingPaise,
        "the statement does not close",
      );

      return `${report.lines.length} lines`;
    },
  },
  {
    name: "party_statement_busy_refusal",
    route: "parties/$id (PDF)",
    kind: "refusal",
    run: () =>
      refusal(
        client.party.statement({ ...org, partyId: busyParty.partyId, from: "2000-01-01" }),
        "REPORT_TOO_LARGE",
      ),
  },
];

// Every document register: first page, second page, party filter and five searches.
type RegisterList = (input: {
  orgSlug: string;
  q?: string;
  cursor?: string;
  partyId?: string;
}) => Promise<{
  rows: { id: string; number: string | null; partyName: string | null }[];
  hasMore: boolean;
}>;

const registers: { name: string; route: string; list: RegisterList }[] = [
  { name: "invoices", route: "invoices", list: (input) => client.invoice.list(input) },
  { name: "bills", route: "bills", list: (input) => client.bill.list(input) },
  { name: "receipts", route: "receipts", list: (input) => client.receipt.list(input) },
  { name: "payments", route: "payments", list: (input) => client.payment.list(input) },
  { name: "notes", route: "notes", list: (input) => client.note.list(input) },
];

for (const { list, ...register } of registers) {
  // The register's own number prefix: every document of the series shares it.
  const prefix =
    (await list(org)).rows.find((row) => row.number)?.number?.slice(0, 3) ??
    fail(`${register.name} has no numbered document`);

  const otherOrgSearch: [string, string, { max?: number }][] = otherOrgName
    ? [["other_org", otherOrgName, {}]]
    : [];

  const searches: [string, string, { min?: number; max?: number }][] = [
    ["number", oldNumber, {}],
    ["fragment", oldNumber.slice(-5), {}],
    ["prefix", prefix, { min: 1 }],
    ["name", commonName, {}],
    ["miss", "zzqx-none", { max: 0 }],
    ...otherOrgSearch,
  ];

  reads.push(
    {
      name: `${register.name}_first_page`,
      route: register.route,
      kind: "read",
      run: async () => page(await list(org), { min: 1 }),
    },
    {
      name: `${register.name}_second_page`,
      route: register.route,
      kind: "read",
      prepare: async () => {
        const cursor = (await list(org)).rows.at(-1)?.id;

        return async () => page(await list({ ...org, cursor }));
      },
    },
    {
      name: `${register.name}_party_small`,
      route: register.route,
      kind: "read",
      run: async () => {
        const result = await list({ ...org, partyId: smallParty.partyId });

        check(
          result.rows.every((row) => row.partyName === smallPartyName),
          "the party filter returned another party",
        );

        return page(result);
      },
    },
    ...searches.map(([label, term, expect]): Scenario => ({
      name: `${register.name}_search_${label}`,
      route: register.route,
      kind: "search",
      run: async () => {
        const result = await list({ ...org, q: term });

        searched(result.rows, term);

        return page(result, expect);
      },
    })),
  );
}

reads.push(
  {
    // A term with no trigram would read the whole search index (10 s on 1 M
    // documents), so validation must refuse it before any query runs.
    name: "receipts_search_punctuation_refusal",
    route: "receipts, palette",
    kind: "refusal",
    run: async () => {
      const error = await client.receipt.list({ ...org, q: "---" }).then(
        () => fail("a punctuation-only search was accepted"),
        (error: unknown) => error,
      );

      check(
        error instanceof ORPCError && error.code === "BAD_REQUEST",
        `expected BAD_REQUEST, got ${String(error)}`,
      );

      return "BAD_REQUEST";
    },
  },
  {
    name: "receipts_search_old_number_found",
    route: "receipts, palette",
    kind: "search",
    run: async () =>
      page(await client.receipt.list({ ...org, q: oldNumber }), {
        min: 1,
        includes: oldReceipt.id,
      }),
  },
  {
    name: "invoices_status_open",
    route: "invoices",
    kind: "read",
    run: async () => page(await client.invoice.list({ ...org, status: "open" })),
  },
  {
    name: "invoices_status_overdue",
    route: "invoices",
    kind: "read",
    run: async () => page(await client.invoice.list({ ...org, status: "overdue" })),
  },
  {
    name: "receipts_state_cancelled",
    route: "receipts",
    kind: "read",
    run: async () => page(await client.receipt.list({ ...org, state: "cancelled" })),
  },
  {
    name: "journals_first_page",
    route: "journals",
    kind: "read",
    run: async () => page(await client.journal.list(org)),
  },
  {
    name: "journals_search_miss",
    route: "journals",
    kind: "search",
    run: async () => page(await client.journal.list({ ...org, q: "zzqx-none" }), { max: 0 }),
  },

  // Document views.
  {
    name: "invoice_get",
    route: "invoices/$id",
    kind: "read",
    run: async () => (await client.invoice.get({ ...org, invoiceId: invoice.id })).state,
  },
  {
    name: "bill_get",
    route: "bills/$id",
    kind: "read",
    run: async () => (await client.bill.get({ ...org, billId: bill.id })).state,
  },
  {
    name: "receipt_get",
    route: "receipts/$id",
    kind: "read",
    run: async () => (await client.receipt.get({ ...org, receiptId: newestReceipt.id })).state,
  },
  {
    name: "payment_get",
    route: "payments/$id",
    kind: "read",
    run: async () => (await client.payment.get({ ...org, paymentId: payment.id })).state,
  },
  ...(note
    ? [
        {
          name: "note_get",
          route: "notes/$id",
          kind: "read",
          run: async () => (await client.note.get({ ...org, noteId: note.id })).state,
        } satisfies Scenario,
      ]
    : []),
  ...(journal
    ? [
        {
          name: "journal_get",
          route: "journals/$id",
          kind: "read",
          run: async () => (await client.journal.get({ ...org, journalId: journal.id })).state,
        } satisfies Scenario,
      ]
    : []),
  {
    name: "invoice_quote",
    route: "invoices/new",
    kind: "read",
    run: async () => {
      const quote = await client.invoice.quote({
        ...org,
        partyId: customer.id,
        placeOfSupplyStateCode: customer.stateCode ?? "27",
        lines: [{ kind: "item", itemId: item.id, quantity: 3 }],
      });

      check(quote.totalPaise > 0n, "the quote has no total");

      return `total ${quote.totalPaise}`;
    },
  },

  // Reports.
  {
    name: "trial_balance",
    route: "reports/trial-balance",
    kind: "report",
    run: async () => {
      const { totals } = await client.report.trialBalance({ ...org, from, to: today });

      check(
        totals.closingDebitPaise === totals.closingCreditPaise,
        "the trial balance does not balance",
      );

      return `closing ${totals.closingDebitPaise}`;
    },
  },
  {
    name: "profit_and_loss",
    route: "reports/profit-and-loss",
    kind: "report",
    run: async () => {
      const report = await client.report.profitAndLoss({ ...org, from, to: today });

      check(
        report.incomePaise - report.expensesPaise === report.netProfitPaise,
        "profit does not add up",
      );

      return `net ${report.netProfitPaise}`;
    },
  },
  {
    name: "balance_sheet",
    route: "reports/balance-sheet",
    kind: "report",
    run: async () => {
      const report = await client.report.balanceSheet({ ...org, asOf: today });

      check(
        report.assetsPaise === report.liabilitiesPaise + report.equityPaise,
        "the balance sheet does not balance",
      );

      return `assets ${report.assetsPaise}`;
    },
  },
  {
    name: "account_ledger_summary",
    route: "reports/account-ledger",
    kind: "aggregate",
    run: async () => {
      const summary = await client.report.accountLedgerSummary({
        ...org,
        accountId: moneyAccount.id,
        from,
        to: today,
      });

      check(
        summary.openingPaise + summary.debitPaise - summary.creditPaise === summary.closingPaise,
        "the ledger summary does not close",
      );

      return `closing ${summary.closingPaise}`;
    },
  },
  {
    name: "account_ledger_lines",
    route: "reports/account-ledger",
    kind: "read",
    run: async () =>
      `${(await client.report.accountLedgerLines({ ...org, accountId: moneyAccount.id, from, to: today })).rows.length} lines`,
  },
  {
    name: "account_ledger_pdf_refusal",
    route: "reports/account-ledger (PDF)",
    kind: "refusal",
    run: () =>
      refusal(
        client.report.accountLedger({ ...org, accountId: moneyAccount.id, from, to: today }),
        "REPORT_TOO_LARGE",
      ),
  },
  {
    name: "day_book_summary_today",
    route: "reports/day-book",
    kind: "aggregate",
    run: async () => {
      const summary = await client.report.dayBookSummary({ ...org, from: today, to: today });

      check(summary.debitPaise === summary.creditPaise, "the day book does not balance");

      return `${summary.entryCount} entries`;
    },
  },
  {
    name: "day_book_entries_today",
    route: "reports/day-book",
    kind: "read",
    run: async () =>
      `${(await client.report.dayBookEntries({ ...org, from: today, to: today })).rows.length} entries`,
  },
  {
    name: "day_book_month_summary",
    route: "reports/day-book",
    kind: "aggregate",
    run: async () =>
      `${(await client.report.dayBookSummary({ ...org, from: monthStart, to: today })).entryCount} entries`,
  },

  // Exports.
  {
    name: "export_trial_balance",
    route: "reports (XLSX)",
    kind: "export",
    run: async () => xlsx(await client.export.trialBalanceXlsx({ ...org, from, to: today })),
  },
  {
    name: "export_profit_and_loss",
    route: "reports (XLSX)",
    kind: "export",
    run: async () => xlsx(await client.export.profitAndLossXlsx({ ...org, from, to: today })),
  },
  {
    name: "export_balance_sheet",
    route: "reports (XLSX)",
    kind: "export",
    run: async () => xlsx(await client.export.balanceSheetXlsx({ ...org, asOf: today })),
  },
  {
    name: "export_party_statement_small",
    route: "parties (XLSX)",
    kind: "export",
    run: async () =>
      xlsx(
        await client.export.partyStatementXlsx({
          ...org,
          partyId: smallParty.partyId,
          from: monthStart,
          to: today,
        }),
      ),
  },
  {
    name: "export_account_ledger_refusal",
    route: "reports (XLSX)",
    kind: "refusal",
    run: () =>
      refusal(
        client.export.accountLedgerXlsx({ ...org, accountId: moneyAccount.id, from, to: today }),
        "REPORT_TOO_LARGE",
      ),
  },
  {
    name: "export_party_statement_busy",
    route: "parties (XLSX)",
    kind: "export",
    run: async () =>
      xlsx(
        await client.export.partyStatementXlsx({
          ...org,
          partyId: busyParty.partyId,
          from: "2000-01-01",
        }),
      ),
  },
  {
    name: "export_gst_outward_month",
    route: "reports (XLSX)",
    kind: "export",
    run: async () =>
      xlsx(await client.export.gstOutwardXlsx({ ...org, from: monthStart, to: today })),
  },
  {
    name: "export_gst_inward_month",
    route: "reports (XLSX)",
    kind: "export",
    run: async () =>
      xlsx(await client.export.gstInwardXlsx({ ...org, from: monthStart, to: today })),
  },
  {
    name: "export_tds_month",
    route: "reports (XLSX)",
    kind: "export",
    run: async () =>
      xlsx(await client.export.tdsRegisterXlsx({ ...org, from: monthStart, to: today })),
  },
);

// ---- Writes: each call creates, changes or removes a real row, and is checked. ----

const invoiceLines = [{ kind: "item" as const, itemId: item.id, quantity: 1 }];

const invoiceHeader = () => ({
  ...org,
  partyId: customer.id,
  placeOfSupplyStateCode: customer.stateCode ?? "27",
  documentDate: today,
  reference: `PERF-${unique()}`,
  lines: invoiceLines,
});

async function postedInvoice() {
  return client.invoice.post(invoiceHeader());
}

const writes: Scenario[] = [
  {
    name: "party_create",
    route: "parties",
    kind: "write",
    run: async () => {
      const party = await client.party.create({
        ...org,
        name: `Perf Party ${unique()}`,
        roles: ["customer"],
        stateCode: "27",
      });

      check(party.id, "party.create returned no id");

      return "inserted";
    },
  },
  {
    name: "party_update",
    route: "parties",
    kind: "write",
    prepare: async () => {
      const party = await (() =>
        client.party.create({
          ...org,
          name: `Perf Update ${unique()}`,
          roles: ["customer"],
          stateCode: "27",
        }))();

      return async () => {
        const updated = await client.party.update({
          ...org,
          partyId: party.id,
          name: `${party.name} B`,
          roles: ["customer"],
          stateCode: "27",
          active: true,
          updatedAt: party.updatedAt.toISOString(),
        });

        check(updated.name.endsWith(" B"), "party.update kept the old name");

        return "updated";
      };
    },
  },
  {
    name: "item_create",
    route: "items",
    kind: "write",
    run: async () => {
      const created = await client.item.create({
        ...org,
        name: `Perf Item ${unique()}`,
        unit: "nos",
        unitPrice: "10.00",
        incomeAccountId: item.incomeAccountId,
        taxCode: taxCode.code,
      });

      check(created.id, "item.create returned no id");

      return "inserted";
    },
  },
  {
    name: "invoice_draft_insert",
    route: "invoices/new",
    kind: "write",
    run: async () => {
      const draft = await client.invoice.saveDraft(invoiceHeader());

      check(draft.version === 1, "a new draft is not version 1");

      return "inserted";
    },
  },
  {
    name: "invoice_draft_update",
    route: "invoices/$id/edit",
    kind: "write",
    prepare: async () => {
      const draft = await (() => client.invoice.saveDraft(invoiceHeader()))();

      return async () => {
        const saved = await client.invoice.saveDraft({
          ...invoiceHeader(),
          draft: { id: draft.id, version: draft.version },
        });

        check(
          saved.id === draft.id && saved.version === draft.version + 1,
          "the draft did not update in place",
        );

        return "updated";
      };
    },
  },
  {
    name: "invoice_draft_discard",
    route: "invoices/$id/edit",
    kind: "write",
    prepare: async () => {
      const draft = await (() => client.invoice.saveDraft(invoiceHeader()))();

      return async () => {
        const discarded = await client.invoice.discardDraft({
          ...org,
          draft: { id: draft.id, version: draft.version },
        });

        check(discarded.id === draft.id, "the draft was not deleted");

        return "deleted";
      };
    },
  },
  {
    name: "invoice_post",
    route: "invoices/new",
    kind: "write",
    run: async () => {
      const posted = await postedInvoice();

      check(posted.number, "the invoice has no number");

      return "posted";
    },
  },
  {
    name: "invoice_cancel",
    route: "invoices/$id",
    kind: "write",
    prepare: async () => {
      const posted = await postedInvoice();

      return async () => {
        const cancelled = await client.invoice.cancel({
          ...org,
          invoiceId: posted.id,
          reason: "Benchmark",
        });

        check(cancelled.state === "cancelled", "the invoice is not cancelled");

        return "cancelled";
      };
    },
  },
  {
    name: "receipt_post_advance",
    route: "receipts/new",
    kind: "write",
    run: async () => {
      const receipt = await client.receipt.post({
        ...org,
        settlementKind: "advance",
        advanceSupply: "exempt",
        partyId: customer.id,
        amount: "10.00",
        paymentMethodId: method.id,
        documentDate: today,
      });

      check(receipt.number, "the receipt has no number");

      return "posted";
    },
  },
  {
    name: "allocation_apply",
    route: "receipts/$id",
    kind: "write",
    prepare: async () => {
      const [target, source] = await Promise.all([
        postedInvoice(),
        client.receipt.post({
          ...org,
          settlementKind: "advance",
          advanceSupply: "exempt",
          partyId: customer.id,
          amount: "1.00",
          paymentMethodId: method.id,
          documentDate: today,
        }),
      ]);

      return async () => {
        const applied = await client.allocation.apply({
          ...org,
          sourceDocumentId: source.id,
          targetDocumentId: target.id,
          amount: "1.00",
        });

        check(applied.length === 1, "the allocation did not apply");

        return "applied";
      };
    },
  },
  {
    name: "bill_post",
    route: "bills/new",
    kind: "write",
    run: async () => {
      const posted = await client.bill.post({
        ...org,
        partyId: vendor.id,
        documentDate: today,
        reference: `PERF-${unique()}`,
        lines: [
          { accountId: expense.id, description: "Benchmark", amount: "10.00", itcEligible: false },
        ],
      });

      check(posted.id, "the bill has no id");

      return "posted";
    },
  },
  {
    name: "payment_post_advance",
    route: "payments/new",
    kind: "write",
    run: async () => {
      const posted = await client.payment.post({
        ...org,
        settlementKind: "advance",
        partyId: vendor.id,
        amount: "10.00",
        paymentMethodId: method.id,
        documentDate: today,
      });

      check(posted.number, "the payment has no number");

      return "posted";
    },
  },
  {
    name: "credit_note_post",
    route: "notes/new",
    kind: "write",
    prepare: async () => {
      const source = await (async () =>
        client.invoice.get({ ...org, invoiceId: (await postedInvoice()).id }))();

      return async () => {
        const line = source.lines[0] ?? fail("the invoice has no line");

        const posted = await client.note.post({
          ...org,
          type: "creditNote",
          againstDocumentId: source.id,
          documentDate: today,
          narration: "Benchmark return",
          lines: [{ sourceLineId: line.id, amount: "1.00" }],
        });

        check(posted.number, "the note has no number");

        return "posted";
      };
    },
  },
  {
    name: "journal_post",
    route: "journals/new",
    kind: "write",
    run: async () => {
      const posted = await client.journal.post({
        ...org,
        documentDate: today,
        narration: `Benchmark ${unique()}`,
        lines: [
          { accountId: expense.id, side: "debit", amount: "1.00" },
          { accountId: moneyAccount.id, side: "credit", amount: "1.00" },
        ],
      });

      check(posted.number, "the journal has no number");

      return "posted";
    },
  },
];

const scenarios = [...reads, ...(WRITES ? writes : [])];

const known = new Set([...reads, ...writes].map((scenario) => scenario.name));

if (known.size !== reads.length + writes.length) throw new Error("Two scenarios share a name");

if (SELECTED) {
  const unknown = SELECTED.filter((name) => !known.has(name));

  if (SELECTED.length === 0 || unknown.length > 0) {
    throw new Error(`Unknown PERF_SCENARIOS: ${unknown.join(", ") || "(empty)"}`);
  }

  const writeNames = new Set(writes.map((scenario) => scenario.name));

  if (!WRITES && SELECTED.some((name) => writeNames.has(name))) {
    throw new Error("A write scenario was selected; set PERF_WRITES=1 to run writes");
  }
}

// ---- Runner: check the first answer, warm up, then time and check every call. ----

async function call(scenario: Scenario): Promise<{ ms: number; result: string }> {
  const run = "prepare" in scenario ? await scenario.prepare() : scenario.run;
  const startedAt = performance.now();
  const result = await run();

  return { ms: performance.now() - startedAt, result };
}

const reports: ScenarioReport[] = [];

for (const scenario of scenarios) {
  if (SELECTED && !SELECTED.includes(scenario.name)) continue;

  let first: { ms: number; result: string };

  try {
    first = await call(scenario);
  } catch (error) {
    throw new Error(`${scenario.name}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  for (let index = 0; index < WARMUP_COUNT; index += 1) await call(scenario);

  const durations: number[] = [];

  for (let index = 0; index < REQUEST_COUNT; index += 1) {
    const { ms, result } = await call(scenario);

    if (result !== first.result && scenario.kind !== "write") {
      throw new Error(`${scenario.name}: answered "${result}" after "${first.result}"`);
    }

    durations.push(ms);
  }

  durations.sort((left, right) => left - right);

  const report: ScenarioReport = {
    scenario: scenario.name,
    route: scenario.route,
    kind: scenario.kind,
    result: first.result,
    requests: REQUEST_COUNT,
    p50Ms: Math.round(percentile(durations, 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(durations, 0.95) * 10) / 10,
    maxMs: Math.round((durations.at(-1) ?? 0) * 10) / 10,
    firstMs: Math.round(first.ms * 10) / 10,
  };

  reports.push(report);
  console.error(
    `✓ ${report.scenario.padEnd(40)} ${String(report.p50Ms).padStart(8)} ${String(report.p95Ms).padStart(8)} ms  ${report.result}`,
  );
}

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      apiUrl: API_URL,
      orgSlug: ORG_SLUG,
      requestsPerScenario: REQUEST_COUNT,
      warmup: WARMUP_COUNT,
      writes: WRITES,
      inputs,
      scenarios: reports,
    },
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
