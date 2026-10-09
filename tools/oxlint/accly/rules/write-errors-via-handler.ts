import { defineRule } from "@oxlint/plugins";

/**
 * A write that fails with CONFLICT or an uncertain 5xx must refetch what it would have
 * moved; a bare toast leaves the screen stale. handleWriteError owns those outcomes, so an
 * onError in `.mutationOptions({...})` that calls `toast.error` must also call handleWriteError.
 */
export const writeErrorsViaHandlerRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require handleWriteError for a mutation's onError." },
    messages: {
      bareToast:
        "Use handleWriteError from apps/web/src/lib/orpc-error.ts so a conflict or uncertain write refetches.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "mutationOptions"
        )
          return;
        for (const arg of node.arguments) {
          if (arg.type !== "ObjectExpression") continue;
          for (const property of arg.properties) {
            if (
              property.type !== "Property" ||
              property.key.type !== "Identifier" ||
              property.key.name !== "onError"
            )
              continue;
            const body = context.sourceCode.getText(property.value);
            if (body.includes("toast.error(") && !body.includes("handleWriteError("))
              context.report({ node: property, messageId: "bareToast" });
          }
        }
      },
    };
  },
});
