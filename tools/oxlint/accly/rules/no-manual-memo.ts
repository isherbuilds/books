import { defineRule } from "@oxlint/plugins";

/**
 * The React Compiler memoizes components and hooks in apps/web and packages/ui, so a
 * hand-written `useMemo`, `useCallback` or `memo` only adds dependency arrays that can
 * go stale. Catches the named import and the `React.useMemo` namespace form.
 */
const MEMO = new Set(["useMemo", "useCallback", "memo"]);

export const noManualMemoRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow manual memoization where the React Compiler runs." },
    messages: { memo: "React Compiler memoizes; remove manual memoization (`{{name}}`)." },
  },
  createOnce(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react") return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const { imported } = specifier;
          const name = imported.type === "Identifier" ? imported.name : imported.value;
          if (MEMO.has(name))
            context.report({ node: specifier, messageId: "memo", data: { name } });
        }
      },
      MemberExpression(node) {
        const { object, property } = node;
        if (
          object.type === "Identifier" &&
          object.name === "React" &&
          property.type === "Identifier" &&
          MEMO.has(property.name)
        )
          context.report({ node, messageId: "memo", data: { name: property.name } });
      },
    };
  },
});
