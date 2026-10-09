import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * A hand-built `/api/...` URL escapes the route tree's types and breaks silently on a
 * rename. A route id in a `to` prop or property is the typed form, so it passes.
 */
function isRouteTarget(node: ESTree.Node): boolean {
  const { parent } = node;
  if (parent?.type === "JSXAttribute")
    return parent.name.type === "JSXIdentifier" && parent.name.name === "to";
  return (
    parent?.type === "Property" &&
    parent.value === node &&
    parent.key.type === "Identifier" &&
    parent.key.name === "to"
  );
}
export const noApiUrlLiteralRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow hand-built /api/ URLs in web code." },
    messages: {
      apiUrl:
        "Use a typed Link to the apps/web/src/routes/api.$orgSlug.*.pdf route (or router.buildLocation for window.open) instead of a hand-built `/api/` URL.",
    },
  },
  createOnce(context) {
    return {
      Literal(node) {
        if (
          typeof node.value === "string" &&
          node.value.startsWith("/api/") &&
          !isRouteTarget(node)
        )
          context.report({ node, messageId: "apiUrl" });
      },
      TemplateLiteral(node) {
        if (node.quasis[0]?.value.raw.startsWith("/api/"))
          context.report({ node, messageId: "apiUrl" });
      },
    };
  },
});
