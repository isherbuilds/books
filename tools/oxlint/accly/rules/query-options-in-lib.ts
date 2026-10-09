import { defineRule } from "@oxlint/plugins";

/**
 * A route or component that builds `orpc.x.queryOptions(...)` inline cannot share the query key with
 * the loader, the component and the invalidation that need the same query.
 */
export const queryOptionsInLibRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow inline oRPC query options outside apps/web/src/lib." },
    messages: {
      inlineOptions:
        "Add a named query-options factory in apps/web/src/lib/<domain>.ts and call it here.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          (callee.property.name !== "queryOptions" && callee.property.name !== "infiniteOptions")
        )
          return;
        let root = callee.object;
        while (root.type === "MemberExpression") root = root.object;
        if (root.type === "Identifier" && root.name === "orpc")
          context.report({ node, messageId: "inlineOptions" });
      },
    };
  },
});
