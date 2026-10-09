import { defineRule } from "@oxlint/plugins";

/** Every list pages by the server's `nextCursor`; lib/orpc.ts owns that one reader. */
export const pagingFromOrpcRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow hand-written getNextPageParam outside lib/orpc.ts." },
    messages: {
      paging:
        "Spread `nextPage` from apps/web/src/lib/orpc.ts instead of writing getNextPageParam.",
    },
  },
  createOnce(context) {
    return {
      Property(node) {
        if (
          (node.key.type === "Identifier" && node.key.name === "getNextPageParam") ||
          (node.key.type === "Literal" && node.key.value === "getNextPageParam")
        )
          context.report({ node, messageId: "paging" });
      },
    };
  },
});
