import interLatinExtSource from "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?inline";
import devanagariRegularSource from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2?inline";
import devanagariBoldSource from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2?inline";
import type { NodeInput } from "takumi-pdf";
import { render } from "takumi-pdf";
import { PageNumber, TotalPages } from "takumi-pdf/primitives";

const PAGE_MARGIN = { bottom: 46, left: 44, right: 44, top: 40 };

async function readBundledFont(source: string): Promise<Uint8Array> {
  if (source.startsWith("data:")) {
    const response = await fetch(source);

    if (!response.ok) throw new Error(`Could not decode bundled font: ${response.status}`);

    return new Uint8Array(await response.arrayBuffer());
  }

  // Bun exposes imported binary assets as absolute paths in unit tests. Vite
  // inlines the same imports in the server build, so this branch is test-only.
  const { readFile } = await import("node:fs/promises");

  return new Uint8Array(await readFile(source));
}

// The renderer's built-in sans-serif fallback covers ₹ only after a warm render,
// so the first document of a process failed with "No registered font covers ₹".
// Registering Inter for the currency block makes every render deterministic.
const fonts = [
  {
    key: "accly-inter-currency-v1",
    name: "Inter",
    weight: 400,
    ranges: [[0x20a0, 0x20c0] satisfies [number, number]],
    data: () => readBundledFont(interLatinExtSource),
  },
  {
    key: "accly-noto-devanagari-400-v1",
    name: "Noto Sans Devanagari",
    weight: 400,
    ranges: [[0x0900, 0x097f] satisfies [number, number]],
    data: () => readBundledFont(devanagariRegularSource),
  },
  {
    key: "accly-noto-devanagari-700-v1",
    name: "Noto Sans Devanagari",
    weight: 700,
    ranges: [[0x0900, 0x097f] satisfies [number, number]],
    data: () => readBundledFont(devanagariBoldSource),
  },
];

function footerBand(caption: string) {
  return (
    <div
      style={{
        color: "#71717a",
        display: "flex",
        fontSize: 8,
        justifyContent: "space-between",
        paddingLeft: 44,
        paddingRight: 44,
        width: "100%",
      }}
    >
      <span>{caption}</span>
      <span>
        Page <PageNumber /> of <TotalPages />
      </span>
    </div>
  );
}

export async function renderPdf(
  element: NodeInput,
  options: { fileName: string; title: string; width?: number },
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const common = {
    fontFamilies: ["sans-serif", "Inter", "Noto Sans Devanagari"],
    fonts,
    lang: "en-IN",
    metadata: { creator: "Accly Books", title: options.title },
  };

  const bytes =
    options.width === undefined
      ? await render(element, {
          ...common,
          footer: footerBand(options.title),
          margin: PAGE_MARGIN,
          size: "a4",
        })
      : await render(element, { ...common, viewport: { width: options.width } });

  return { bytes, fileName: options.fileName };
}
