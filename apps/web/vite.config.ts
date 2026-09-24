import { resolve } from "node:path";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // The monorepo's single .env, which the SSR half also loads through @accly/env.
  envDir: resolve(import.meta.dirname, "../../packages/env"),
  // Dev ports are one project-owned block (55442-55451) so several checkouts of
  // different products can run at once; `strictPort` fails loudly instead of
  // silently landing on a neighbour's port. Production reads PORT.
  server: {
    port: 55444,
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
    // Nitro's Bun preset resolves takumi-pdf's `bun` entry, which reads its .wasm as a
    // file path that the bundled server no longer has, so every receipt PDF was a 500.
    // Its `unwasm` entry imports the module the way Nitro bundles it. Dev leaves
    // the dependency external, so its .wasm file remains available on disk.
    alias: command === "build" ? [{ find: /^takumi-pdf$/, replacement: "takumi-pdf/next" }] : [],
  },
  build: {
    // The production CSP allows `font-src 'self'` only, so a font Vite would inline as
    // a `data:` URI (a small subset under 4 KiB) is refused; fonts always ship as files.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
  },
  environments: {
    ssr: {
      build: {
        rolldownOptions: {
          // The SSR graph splits into mutually importing chunks; without this the
          // runtime helpers are read before their chunk assigns them (TDZ 500).
          output: { strictExecutionOrder: true },
        },
      },
    },
  },
  plugins: [
    // Changelog entries are `.mdx` under `src/content/`; compiled to JSX before
    // the React plugin sees them, so `enforce: "pre"`.
    { enforce: "pre", ...mdx({ jsxImportSource: "react" }) },
    tailwindcss(),
    tanstackStart(),
    nitro({
      // The Bun preset serves `.output/public` itself, so precompress hashed assets for
      // deployments with no compression-capable CDN in front.
      compressPublicAssets: { gzip: true, brotli: true },
      inlineDynamicImports: true,
    }),
    // React Compiler on, via oxc. Money never reaches it as a bigint literal: oxc's
    // compiler pass rewrites bigint literals inside a compiled component to `undefined`
    // with no error, so `paise === 0n` would silently become `paise === undefined`.
    // Every amount goes through the helpers in `@accly/api/core/money` — a module with
    // no components, which the pass leaves alone — and `oxlint` bans bigint literals in
    // `.tsx` so one cannot creep back in.
    viteReact({ compiler: true }),
  ],
}));
