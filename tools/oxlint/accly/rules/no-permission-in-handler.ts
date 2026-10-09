import { defineRule } from "@oxlint/plugins";

/**
 * The permission guard runs once, in `orgProcedure` (lib/procedures/factory.ts), before
 * the handler. A `requirePermission` call inside a handler or core function is a second,
 * later check the procedure's declaration does not show.
 */
export const noPermissionInHandlerRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow requirePermission outside the orgProcedure owner." },
    messages: {
      handlerPermission:
        "Pass the permission (or `(input) => permission`) to orgProcedure in packages/api/src/lib/procedures/factory.ts instead of calling requirePermission here.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "requirePermission")
          context.report({ node, messageId: "handlerPermission" });
      },
    };
  },
});
