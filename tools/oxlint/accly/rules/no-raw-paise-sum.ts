import { defineRule } from "@oxlint/plugins";

/**
 * Postgres `sum()` returns numeric, and null over no rows. `paiseSum` in lib/sql.ts casts
 * to bigint, coalesces to zero and maps with BigInt; a hand-written sum forgets one.
 */
export const noRawPaiseSumRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow sum() in sql templates outside lib/sql.ts." },
    messages: {
      rawSum:
        "Use paiseSum(column) from packages/api/src/lib/sql.ts instead of a raw `sum(` in sql.",
    },
  },
  createOnce(context) {
    return {
      TaggedTemplateExpression(node) {
        if (node.tag.type !== "Identifier" || node.tag.name !== "sql") return;
        if (node.quasi.quasis.some((quasi) => /\bsum\s*\(/i.test(quasi.value.raw)))
          context.report({ node, messageId: "rawSum" });
      },
    };
  },
});
