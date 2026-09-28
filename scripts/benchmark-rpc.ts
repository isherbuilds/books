import type { AppRouter } from "@accly/api/routers/index";
import { businessDate } from "@accly/api/lib/business-date";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

const API_URL = process.env.PERF_API_URL ?? "http://127.0.0.1:3100";

const WEB_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3101";

const EMAIL = process.env.PERF_EMAIL;

const PASSWORD = process.env.PERF_PASSWORD;

const REQUEST_COUNT = Number(process.env.PERF_RPC_REQUESTS ?? 200);

const WARMUP_COUNT = 20;

const ORG_SLUG = process.env.PERF_ORG_SLUG ?? "meridian-traders";

if (!EMAIL || !PASSWORD) {
  throw new Error("Set PERF_EMAIL and PERF_PASSWORD to a benchmark fixture account");
}

if (!Number.isInteger(REQUEST_COUNT) || REQUEST_COUNT < 1) {
  throw new Error("PERF_RPC_REQUESTS must be a positive integer");
}

type Scenario = {
  name: string;
  run: () => Promise<void>;
};

type ScenarioReport = {
  scenario: string;
  requests: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
  failures: number;
};

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function signIn(): Promise<string> {
  const response = await fetch(new URL("/api/auth/sign-in/email", API_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: WEB_URL,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!response.ok) throw new Error(`Benchmark sign-in failed: ${response.status}`);
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0];

  if (!cookie) throw new Error("Benchmark sign-in returned no session cookie");

  return cookie;
}

function createClient(cookie: string): RouterClient<AppRouter> {
  const link = new RPCLink({
    url: `${API_URL}/rpc`,
    headers: {
      cookie,
      origin: WEB_URL,
    },
  });

  return createORPCClient(link);
}

async function runScenario(scenario: Scenario): Promise<ScenarioReport> {
  let failures = 0;

  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    try {
      await scenario.run();
    } catch {
      failures += 1;
    }
  }

  const durations: number[] = [];

  for (let index = 0; index < REQUEST_COUNT; index += 1) {
    const startedAt = performance.now();

    try {
      await scenario.run();
    } catch {
      failures += 1;
    }

    durations.push(performance.now() - startedAt);
  }

  if (failures > 0) {
    throw new Error(`RPC benchmark scenario ${scenario.name} observed ${failures} failed requests`);
  }

  durations.sort((left, right) => left - right);

  return {
    scenario: scenario.name,
    requests: REQUEST_COUNT,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    meanMs: durations.reduce((total, duration) => total + duration, 0) / durations.length,
    failures,
  };
}

const cookie = await signIn();

const client = createClient(cookie);

const { timeZone } = await client.member.me({ orgSlug: ORG_SLUG });

const to = businessDate(new Date(), timeZone);

const start = new Date(to);

start.setUTCDate(start.getUTCDate() - 364);

const from = start.toISOString().slice(0, 10);

// The party with the least received has few documents, so a party filter that walks
// the register instead of seeking the party shows here; it may have no invoices at all.
// One of its receipt numbers is a search target that sits anywhere in the register,
// unlike the newest page.
const partyTotals = await client.receipt.partyTotals({ orgSlug: ORG_SLUG });

const smallParty = partyTotals.reduce((least, row) =>
  row.receivedPaise < least.receivedPaise ? row : least,
);

// The busiest customer has the longest settlement history for the Receipt pickers.
const busyParty = partyTotals.reduce((most, row) =>
  row.receivedPaise > most.receivedPaise ? row : most,
);

const [smallPartyReceipt] = (
  await client.receipt.list({ orgSlug: ORG_SLUG, partyId: smallParty.partyId })
).rows;

const [newestReceipt] = (await client.receipt.list({ orgSlug: ORG_SLUG })).rows;

const searchNumber = smallPartyReceipt?.number;

const commonName = newestReceipt?.partyName?.split(" ")[0];

if (!searchNumber || !commonName) {
  throw new Error("The fixture needs posted receipts with numbers and party names");
}

// Reads only, so a run leaves the fixture unchanged.
const scenarios: Scenario[] = [
  {
    name: "receipts_first_page",
    run: async () => {
      await client.receipt.list({ orgSlug: ORG_SLUG });
    },
  },
  {
    name: "invoices_first_page",
    run: async () => {
      await client.invoice.list({ orgSlug: ORG_SLUG });
    },
  },
  {
    name: "bills_first_page",
    run: async () => {
      await client.bill.list({ orgSlug: ORG_SLUG });
    },
  },
  {
    name: "credit_notes_first_page",
    run: async () => {
      await client.note.list({ orgSlug: ORG_SLUG, type: "creditNote" });
    },
  },
  {
    name: "debit_notes_first_page",
    run: async () => {
      await client.note.list({ orgSlug: ORG_SLUG, type: "debitNote" });
    },
  },
  {
    name: "payments_first_page",
    run: async () => {
      await client.payment.list({ orgSlug: ORG_SLUG });
    },
  },
  {
    name: "receipts_query_utr",
    run: async () => {
      await client.receipt.list({ orgSlug: ORG_SLUG, q: "UTR" });
    },
  },
  {
    name: "receipts_party_small",
    run: async () => {
      await client.receipt.list({ orgSlug: ORG_SLUG, partyId: smallParty.partyId });
    },
  },
  {
    name: "invoices_party_small",
    run: async () => {
      await client.invoice.list({ orgSlug: ORG_SLUG, partyId: smallParty.partyId });
    },
  },
  {
    name: "receipts_query_number",
    run: async () => {
      await client.receipt.list({ orgSlug: ORG_SLUG, q: searchNumber });
    },
  },
  {
    name: "receipts_query_fragment",
    run: async () => {
      await client.receipt.list({ orgSlug: ORG_SLUG, q: searchNumber.slice(-6) });
    },
  },
  {
    name: "receipts_query_miss",
    run: async () => {
      await client.receipt.list({ orgSlug: ORG_SLUG, q: "zzqx-none" });
    },
  },
  {
    name: "receipts_query_name",
    run: async () => {
      await client.receipt.list({ orgSlug: ORG_SLUG, q: commonName });
    },
  },
  {
    name: "party_open_items",
    run: async () => {
      await client.party.openItems({
        orgSlug: ORG_SLUG,
        partyId: busyParty.partyId,
        side: "receivable",
      });
    },
  },
  {
    name: "party_open_credits",
    run: async () => {
      await client.party.openCredits({
        orgSlug: ORG_SLUG,
        partyId: busyParty.partyId,
        side: "receivable",
      });
    },
  },
  {
    name: "party_list",
    run: async () => {
      await client.party.list({ orgSlug: ORG_SLUG });
    },
  },
  {
    name: "money_balances",
    run: async () => {
      await client.account.moneyBalances({ orgSlug: ORG_SLUG });
    },
  },
  {
    name: "trial_balance",
    run: async () => {
      await client.report.trialBalance({ orgSlug: ORG_SLUG, from, to });
    },
  },
  {
    name: "profit_and_loss",
    run: async () => {
      await client.report.profitAndLoss({ orgSlug: ORG_SLUG, from, to });
    },
  },
  {
    name: "balance_sheet",
    run: async () => {
      await client.report.balanceSheet({ orgSlug: ORG_SLUG, asOf: to });
    },
  },
];

const scenarioReports: ScenarioReport[] = [];

// A comma-separated PERF_SCENARIOS runs only those names, so a before/after pair
// can repeat just the reads a change targets.
const selected = process.env.PERF_SCENARIOS?.split(",");

for (const scenario of scenarios) {
  if (selected && !selected.includes(scenario.name)) continue;
  scenarioReports.push(await runScenario(scenario));
}

const report = JSON.stringify(
  {
    generatedAt: new Date().toISOString(),
    apiUrl: API_URL,
    orgSlug: ORG_SLUG,
    inputs: {
      smallPartyId: smallParty.partyId,
      busyPartyId: busyParty.partyId,
      searchNumber,
      commonName,
    },
    requestsPerScenario: REQUEST_COUNT,
    scenarios: scenarioReports,
  },
  null,
  2,
);

if (process.env.PERF_OUTPUT) await Bun.write(process.env.PERF_OUTPUT, `${report}\n`);

console.log(report);
