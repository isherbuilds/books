import { expect, test } from "bun:test";

import {
  handleWriteError,
  hasErrorCode,
  routeErrorMessage,
} from "../../apps/web/src/lib/orpc-error";

test("nested oRPC codes remain machine-readable for route decisions", () => {
  expect(hasErrorCode({ cause: { code: "UNAUTHORIZED" } }, "UNAUTHORIZED")).toBe(true);
  expect(hasErrorCode({ code: "FORBIDDEN" }, "FORBIDDEN")).toBe(true);
  expect(hasErrorCode(new Error("database unavailable"), "INTERNAL_SERVER_ERROR")).toBe(false);
});

test("production route errors never expose internal exception messages", () => {
  const internal = new Error('relation "member" does not exist');

  expect(routeErrorMessage(internal, false)).toBe("An unexpected error interrupted the request.");
  expect(routeErrorMessage(internal, true)).toBe(internal.message);
  expect(routeErrorMessage("not an error", true)).toBe(
    "An unexpected error interrupted the request.",
  );
});

test("a failed write settles the screen only when it may be stale", async () => {
  const outcome = async (error: unknown, uncertain: string | null) => {
    let result = "none";

    await handleWriteError(error, {
      settle: async () => void (result = "settled"),
      fallback: "Could not save",
      uncertain,
      refuse: () => void (result = "refused"),
    });

    return result;
  };

  const conflict = { status: 409, code: "CONFLICT" };
  const refusal = { status: 400, code: "BAD_REQUEST" };
  const lost = new TypeError("Failed to fetch");

  expect(await outcome(conflict, null)).toBe("settled");
  expect(await outcome(refusal, "Check the list")).toBe("refused");
  expect(await outcome(lost, "Check the list")).toBe("settled");
  // A version token refuses a duplicate retry, so the form keeps its input.
  expect(await outcome(lost, null)).toBe("refused");
});
