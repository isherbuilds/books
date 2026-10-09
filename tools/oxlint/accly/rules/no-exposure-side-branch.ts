import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * A document's settlement role (source, target, refund, advance) is derived from its
 * type and exposure side in one table, core/document-roles.ts. Comparing `.exposureSide`
 * to a side in the web app re-derives that role and drifts from the table. The rule runs
 * on apps/web only: server code narrows its request unions on the side.
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
    docs: { description: "Disallow branching on exposureSide in the web app." },
    messages: {
      sideBranch:
        "Ask documentRole() in packages/api/src/core/document-roles.ts instead of comparing `.exposureSide`.",
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
    };
  },
});
