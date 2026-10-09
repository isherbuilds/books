import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * Money maths belongs to the server or to a named helper in a lib file, so a component
 * shows a figure rather than computing one that can disagree with the books.
 */
function isPaise(node: ESTree.Node): boolean {
  if (node.type === "Identifier") return node.name.endsWith("Paise");
  return (
    node.type === "MemberExpression" &&
    node.property.type === "Identifier" &&
    node.property.name.endsWith("Paise")
  );
}

export const noPaiseArithmeticInComponentsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow adding or subtracting paise in components." },
    messages: {
      paiseMaths:
        "Read the server field, or put input maths in a named helper in an apps/web/src/lib file.",
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        if (
          (node.operator === "+" || node.operator === "-") &&
          (isPaise(node.left) || isPaise(node.right))
        )
          context.report({ node, messageId: "paiseMaths" });
      },
      AssignmentExpression(node) {
        if (
          (node.operator === "+=" || node.operator === "-=") &&
          (isPaise(node.left) || isPaise(node.right))
        )
          context.report({ node, messageId: "paiseMaths" });
      },
    };
  },
});
