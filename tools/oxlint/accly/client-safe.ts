/**
 * The server-package modules the web bundle may import as values. Each is pure: no
 * drizzle, pg, node built-ins or server env, and it imports only other modules on this
 * list. `accly/client-safe-imports` checks both halves of that promise.
 */
export const CLIENT_SAFE_MODULES = new Set([
  "@accly/api/core/amount-in-words",
  "@accly/api/core/document-roles",
  "@accly/api/core/money",
  "@accly/api/core/note-lines",
  "@accly/api/core/number-prefixes",
  "@accly/api/core/tax",
  "@accly/api/lib/business-date",
  "@accly/api/lib/document-labels",
  "@accly/api/lib/import-limits",
  "@accly/api/lib/indian-states",
  "@accly/api/lib/normalized-name",
  "@accly/api/lib/schemas",
  "@accly/db/schema/account-kinds",
  "@accly/db/schema/entry-sides",
  "@accly/db/schema/lock-kinds",
  "@accly/db/schema/settlement-kinds",
]);

const PACKAGE_SOURCES = [
  ["@accly/api/", "packages/api/src/"],
  ["@accly/db/", "packages/db/src/"],
] as const;

/** The module specifier of a source file in a server package, or null outside them. */
export function moduleOfFile(path: string): string | null {
  for (const [specifier, source] of PACKAGE_SOURCES) {
    const at = path.lastIndexOf(`/${source}`);
    if (at !== -1) return specifier + path.slice(at + source.length + 1).replace(/\.tsx?$/, "");
  }
  return null;
}
