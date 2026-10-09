import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * A write that fails with CONFLICT or an uncertain 5xx must refetch what it would have
 * moved; a bare toast leaves the screen stale. handleWriteError owns those outcomes.
 */
function isToastError(node: ESTree.Node | null | undefined): boolean {
  if (node?.type === "ExpressionStatement") return isToastError(node.expression);
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "toast" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "error"
  );
}

function onlyToasts(fn: ESTree.Node): boolean {
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return false;
  const { body } = fn;
  if (body?.type !== "BlockStatement") return isToastError(body);
  return body.body.length === 1 && isToastError(body.body[0]);
}

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
              property.type === "Property" &&
              property.key.type === "Identifier" &&
              property.key.name === "onError" &&
              onlyToasts(property.value)
            )
              context.report({ node: property, messageId: "bareToast" });
          }
        }
      },
    };
  },
});
