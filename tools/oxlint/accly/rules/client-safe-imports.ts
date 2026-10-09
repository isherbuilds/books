import { dirname, resolve } from "node:path";

import { defineRule } from "@oxlint/plugins";

import { CLIENT_SAFE_MODULES, moduleOfFile } from "../client-safe.ts";

import type { ESTree } from "@oxlint/plugins";

const SERVER_ONLY = /^(?:@accly\/db(?:\/|$)|drizzle-orm|pg$|node:|@accly\/env\/server$)/;

/**
 * Keep server modules out of the web bundle. In web code (the default), a value import
 * from `@accly/api` or `@accly/db` must name a module in `client-safe.ts`. In one of
 * those modules, a value import must not reach drizzle, pg, node built-ins, server env,
 * the database package or a relative module off the list. `import type` is always fine.
 * Option `exempt`: path suffixes of server-only web files (createIsomorphicFn server
 * branches, server routes).
 */
export const clientSafeImportsRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow server-only value imports in client code." },
    schema: [
      {
        type: "object",
        properties: { exempt: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      serverOnly:
        "Server-only module `{{source}}` in client code; import type, or move the pure code into an allowlisted module (tools/oxlint/accly/client-safe.ts).",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.ImportDeclaration) => {
      if (node.importKind === "type") return;
      const specifiers = node.specifiers;
      if (
        specifiers.length > 0 &&
        specifiers.every(
          (specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type",
        )
      )
        return;
      const source = node.source.value;
      const file = context.filename;
      const own = moduleOfFile(file);
      let target = source;
      if (own !== null && source.startsWith("."))
        target = moduleOfFile(resolve(dirname(file), source)) ?? source;
      const refused =
        own !== null && CLIENT_SAFE_MODULES.has(own)
          ? SERVER_ONLY.test(target)
            ? !CLIENT_SAFE_MODULES.has(target)
            : source.startsWith(".") && !CLIENT_SAFE_MODULES.has(target)
          : /^@accly\/(?:api|db)(?:\/|$)/.test(source) && !CLIENT_SAFE_MODULES.has(source);
      if (refused) context.report({ node, messageId: "serverOnly", data: { source } });
    };
    return {
      ImportDeclaration(node) {
        const [options] = context.options as [{ exempt?: string[] }?];
        if (options?.exempt?.some((suffix) => context.filename.endsWith(suffix))) return;
        check(node);
      },
    };
  },
});
