import { resolve } from "node:path";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
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
    // React Compiler runs natively through oxc-transform-react (Rust), not Babel.
    // Still marked experimental upstream — if memoization ever looks wrong, drop
    // back to `viteReact()` plus @rolldown/plugin-babel + reactCompilerPreset().
    viteReact({ compiler: true }),
  ],
});
