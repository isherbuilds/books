import { axi as runAxi, parseEvalResult } from "./chrome-axi";

// In-app route changes, which benchmark-browser cannot see: it reads the document's
// navigation entry, and a client-side route change creates none.
//
// Each sample starts a fresh browser, so the Query cache and route chunks start
// cold, then clicks through the sidebar. A later visit to the same route inside the
// sample reuses data younger than the 60s staleTime. Clicks skip hover, so intent
// preloading gets no head start: this is the no-preload case.

const BASE_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3101";

const API_URL = process.env.PERF_API_URL ?? "http://127.0.0.1:3100";

const EMAIL = process.env.PERF_EMAIL;

const PASSWORD = process.env.PERF_PASSWORD;

const ORG_SLUG = process.env.PERF_ORG_SLUG ?? "meridian-traders";

const SAMPLE_COUNT = Number(process.env.PERF_SAMPLES ?? 5);

const NETWORK = process.env.PERF_NETWORK;

if (!EMAIL || !PASSWORD) {
  throw new Error("Set PERF_EMAIL and PERF_PASSWORD to a benchmark fixture account");
}

if (!Number.isInteger(SAMPLE_COUNT) || SAMPLE_COUNT < 1) {
  throw new Error("PERF_SAMPLES must be a positive integer");
}

// The label says whether the route's data could already be cached in this sample.
const steps = [
  { path: `/${ORG_SLUG}/parties`, label: "parties (cold)" },
  { path: `/${ORG_SLUG}/files`, label: "files (cold)" },
  { path: `/${ORG_SLUG}/settings`, label: "settings (cold, redirects)" },
  { path: `/${ORG_SLUG}/receipts`, label: "receipts (fresh cache)" },
  { path: `/${ORG_SLUG}/parties`, label: "parties (fresh cache)" },
];

const browserEnv = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  CHROME_DEVTOOLS_AXI_SESSION: process.env.PERF_CHROME_SESSION ?? "accly-perf-navigation",
  CHROME_DEVTOOLS_AXI_USER_DATA_DIR:
    process.env.PERF_CHROME_PROFILE ?? "/tmp/accly-perf-navigation-profile",
  CHROME_DEVTOOLS_AXI_CHROME_ARGS: "--disk-cache-size=1 --media-cache-size=1",
};

const axi = (args: string[], tolerateFailure = false) => runAxi(browserEnv, args, tolerateFailure);

const signInExpression = `async () => {
  const response = await fetch(${JSON.stringify(`${API_URL}/api/auth/sign-in/email`)}, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(${JSON.stringify({ email: EMAIL, password: PASSWORD })}),
  });
  return { status: response.status };
}`;

// committedMs: the destination heading is on screen. settledMs: no /rpc request is
// in flight for two frames after that, so the page's data has arrived. Counting
// in-flight fetches is the only signal that covers both blocking loaders and
// queries a mounted page starts itself.
const navigationExpression = `async () => {
  const steps = ${JSON.stringify(steps)};
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isRpc = (url) => new URL(url, location.href).pathname.startsWith("/rpc");
  let inFlight = 0;
  const realFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isRpc(url)) return realFetch(input, init);
    inFlight += 1;
    return realFetch(input, init).finally(() => { inFlight -= 1; });
  };
  performance.setResourceTimingBufferSize(2000);
  const heading = () => document.querySelector("main h1")?.textContent?.trim();

  const deadline = performance.now() + 15000;
  while (!document.querySelector('a[href="' + steps[0].path + '"]')) {
    if (performance.now() > deadline) throw new Error("Sidebar never rendered");
    await frame();
  }
  while (inFlight > 0) await frame();
  await wait(500);

  const results = [];
  for (const step of steps) {
    const link = document.querySelector('a[href="' + step.path + '"]');
    if (!link) throw new Error("No link to " + step.path);
    const before = heading();
    const resourcesBefore = performance.getEntriesByType("resource").length;
    const startedAt = performance.now();
    link.click();
    let committedMs;
    let settledMs;
    let quietFrames = 0;
    while (settledMs === undefined) {
      if (performance.now() - startedAt > 15000) throw new Error(step.path + " never settled");
      await frame();
      const now = heading();
      if (committedMs === undefined && location.pathname.startsWith(step.path) && now && now !== before) {
        committedMs = performance.now() - startedAt;
      }
      quietFrames = committedMs !== undefined && inFlight === 0 ? quietFrames + 1 : 0;
      if (quietFrames === 2) settledMs = performance.now() - startedAt;
    }
    const added = performance.getEntriesByType("resource").slice(resourcesBefore);
    results.push({
      label: step.label,
      path: location.pathname,
      heading: heading(),
      committedMs: Math.round(committedMs),
      settledMs: Math.round(settledMs),
      rpcCount: added.filter((entry) => isRpc(entry.name)).length,
      scriptCount: added.filter((entry) => entry.initiatorType === "script").length,
    });
    await wait(500);
  }
  return { steps: results };
}`;

function median(values: number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

type StepResult = {
  label: string;
  path: string;
  heading: string;
  committedMs: number;
  settledMs: number;
  rpcCount: number;
  scriptCount: number;
};

const samples: StepResult[][] = [];

await axi(["stop"], true);

try {
  // The first run warms the database, SSR modules and fonts; it is discarded.
  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    console.error(
      `[navigation benchmark] ${index === 0 ? "warm-up" : `sample ${index}/${SAMPLE_COUNT}`}`,
    );
    await axi(["stop"], true);
    // A fresh browser opens one tab but selects none, so `open` would fail.
    await axi(["start"]);
    await axi(["selectpage", "1"]);
    await axi(["resize", "1440", "900"]);
    await axi(["open", BASE_URL]);
    const signIn = parseEvalResult(await axi(["eval", signInExpression]));

    if (signIn.status !== 200) throw new Error(`Benchmark sign-in failed: ${signIn.status}`);

    if (NETWORK) await axi(["emulate", "--network", NETWORK]);
    await axi(["open", new URL(`/${ORG_SLUG}/receipts`, BASE_URL).toString()]);
    const result = parseEvalResult(await axi(["eval", navigationExpression]));

    if (index > 0) {
      // SAFETY: navigationExpression returns one StepResult per step or throws.
      samples.push(result.steps as StepResult[]);
    }
  }
} finally {
  await axi(["stop"], true);
}

const summary = steps.map((step, position) => {
  const runs = samples.map((sample) => sample[position]!);

  return {
    label: step.label,
    landedOn: runs[0]!.path,
    committedMedianMs: median(runs.map((run) => run.committedMs)),
    settledMedianMs: median(runs.map((run) => run.settledMs)),
    rpcMedian: median(runs.map((run) => run.rpcCount)),
    scriptMedian: median(runs.map((run) => run.scriptCount)),
  };
});

const report = JSON.stringify(
  {
    capturedAt: new Date().toISOString(),
    viewport: "1440x900",
    cache: "fresh browser per sample; disk cache capped at 1 byte; clicks without hover",
    network: NETWORK ?? "unthrottled",
    sampleCount: SAMPLE_COUNT,
    summary,
    samples,
  },
  null,
  2,
);

if (process.env.PERF_OUTPUT) await Bun.write(process.env.PERF_OUTPUT, `${report}\n`);

console.log(report);
