import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * A write that fails with CONFLICT or an uncertain 5xx must refetch what it would have
 * moved; a bare toast leaves the screen stale. handleWriteError owns those outcomes, so an
 * onError in `.mutationOptions({...})` or `useMutation({...})` that calls `toast.error`
 * must also call handleWriteError.
 */
function isCallTo(node: ESTree.Node, object: string | null, name: string): boolean {
  if (node.type !== "CallExpression") return false;
  const { callee } = node;
  if (object === null) return callee.type === "Identifier" && callee.name === name;
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === object &&
    callee.property.type === "Identifier" &&
    callee.property.name === name
  );
}

/** Whether any node under `root` satisfies `test`. Walks plain AST children. */
function contains(root: unknown, test: (node: ESTree.Node) => boolean): boolean {
  if (root === null || typeof root !== "object") return false;
  if (Array.isArray(root)) return root.some((child) => contains(child, test));
  const node = root as ESTree.Node & Record<string, unknown>;
  if (typeof node.type === "string" && test(node)) return true;
  return Object.entries(node).some(([key, child]) => key !== "parent" && contains(child, test));
}

/** An onError that toasts but never reaches handleWriteError. */
function bareToast(fn: ESTree.Node): boolean {
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return false;
  return (
    contains(fn.body, (node) => isCallTo(node, "toast", "error")) &&
    !contains(fn.body, (node) => isCallTo(node, null, "handleWriteError"))
  );
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
        const mutation =
          (callee.type === "MemberExpression" &&
            callee.property.type === "Identifier" &&
            callee.property.name === "mutationOptions") ||
          (callee.type === "Identifier" && callee.name === "useMutation");
        if (!mutation) return;
        for (const arg of node.arguments) {
          if (arg.type !== "ObjectExpression") continue;
          for (const property of arg.properties) {
            if (
              property.type === "Property" &&
              property.key.type === "Identifier" &&
              property.key.name === "onError" &&
              bareToast(property.value)
            )
              context.report({ node: property, messageId: "bareToast" });
          }
        }
      },
    };
  },
});
