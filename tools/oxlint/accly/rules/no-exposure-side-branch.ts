import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * A document's settlement role (source, target, refund, advance) is derived from its
 * type and exposure side in one table, core/document-roles.ts. Comparing `.exposureSide`
 * to a side elsewhere re-derives that role and drifts from the table.
 */
function isExposureSide(node: ESTree.Node): boolean {
  return (
    node.type === "MemberExpression" &&
    node.property.type === "Identifier" &&
    node.property.name === "exposureSide"
  );
}

const isSide = (node: ESTree.Node) =>
  node.type === "Literal" && (node.value === "receivable" || node.value === "payable");

export const noExposureSideBranchRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow branching on exposureSide outside core/document-roles.ts." },
    messages: {
      sideBranch:
        "Ask documentRole() in packages/api/src/core/document-roles.ts (or hasRole() in lib/settlements.ts for SQL) instead of comparing `.exposureSide`.",
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== "===" && node.operator !== "!==") return;
        if (
          (isExposureSide(node.left) && isSide(node.right)) ||
          (isExposureSide(node.right) && isSide(node.left))
        )
          context.report({ node, messageId: "sideBranch" });
      },
      SwitchStatement(node) {
        if (isExposureSide(node.discriminant)) context.report({ node, messageId: "sideBranch" });
      },
      CallExpression(node) {
        const [column] = node.arguments;
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "eq" &&
          column &&
          isExposureSide(column)
        )
          context.report({ node, messageId: "sideBranch" });
      },
    };
  },
});
