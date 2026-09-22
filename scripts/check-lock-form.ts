import { axi, parseEvalResult } from "./chrome-axi";

// Run against a signed-in fixture's Locks page in CHROME_DEVTOOLS_AXI_SESSION.
// Uses the existing browser tooling; it never saves a lock or changes fixture data.
const url = Bun.argv[2];

if (!url || !new URL(url).pathname.endsWith("/settings/locks")) {
  throw new Error("Usage: bun scripts/check-lock-form.ts <fixture Locks URL>");
}

await axi(process.env, ["open", url]);

const result = parseEvalResult(
  await axi(process.env, [
    "eval",
    `async () => {
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const waitFor = async (predicate, message = "Lock form did not settle") => {
        const deadline = performance.now() + 5000;
        while (!predicate()) {
          if (performance.now() > deadline) throw new Error(message);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      const dialog = () => document.querySelector('[role="dialog"]');
      const date = () => dialog()?.querySelector('input[name="lockedThrough"]');
      const reason = () => dialog()?.querySelector('textarea[name="reason"]');
      const change = (label) => document.querySelector('button[aria-label="Change ' + label + ' lock"]').click();
      const cancel = () => [...dialog().querySelectorAll('button')].find(button => button.textContent.trim() === "Cancel").click();
      const fill = (element, value) => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value").set.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      await waitFor(() => document.querySelector('button[aria-label="Change Tax period lock"]'));
      change("Tax period");
      await waitFor(() => date());
      const taxDate = date().value;
      cancel();
      await waitFor(() => !dialog());
      change("Books");
      await waitFor(() => date());
      const generalDate = date().value;
      fill(date(), generalDate === "2026-07-15" ? "2026-07-16" : "2026-07-15");
      fill(reason(), "Unsaved books-lock draft");
      const containingSheet = dialog();

      // The route handler changes the search param without closing the mounted Sheet.
      change("Tax period");
      await waitFor(() => dialog()?.textContent.includes("Lock Tax period") && new URLSearchParams(location.search).get("change") === "tax");
      assert(dialog() === containingSheet, "The regression must keep the containing Sheet mounted");
      assert(date().value === taxDate, "Tax inherited the Books date draft");
      assert(reason().value === "", "Tax inherited the Books reason draft");
      let submitted;
      window.fetch = (input, init) => {
        submitted ??= { input, init };

        // Intentionally never forward or restore fetch in this document. If submission
        // is delayed or retried after an assertion fails, it must remain a dry-run.
        return Promise.reject(new TypeError("Regression dry-run: network is blocked"));
      };
      fill(reason(), "Tax identity regression");
      dialog().querySelector("form").requestSubmit();
      await waitFor(
        () => submitted,
        "Submission did not call fetch within 5 seconds; network remains blocked",
      );
      const request = new Request(submitted.input, submitted.init);
      const requestPath = new URL(request.url).pathname;
      assert(!request.headers.has("x-orpc-batch"), "Submission unexpectedly used batched RPC transport");
      assert(requestPath === "/rpc/lock/set", "Submission used unexpected URL: " + requestPath);
      assert(request.method === "POST", "Submission used unexpected method: " + request.method);
      const payload = (await request.json()).json;
      assert(payload?.kind === "tax", "Submission targets the wrong lock");
      assert(payload.expectedLockedThrough === (taxDate || null), "Tax inherited the Books CAS snapshot");
      return { passed: true, equalDates: generalDate === taxDate };
    }`,
  ]),
);

if (result.passed !== true) throw new Error("Lock form identity check failed");

console.log(result);
