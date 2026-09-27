import { expect, test } from "bun:test";

const GLOBALS = new URL("../../packages/ui/src/styles/globals.css", import.meta.url);

// Anchored to a line start: a bare indexOf(".dark") finds the `@custom-variant`
// declaration above and reads the wrong block.
function blockFor(css: string, selector: string): string {
  const open = css.indexOf(`\n${selector} {`);
  expect(open, `no top-level "${selector} {" rule in globals.css`).toBeGreaterThanOrEqual(0);

  return css.slice(open, css.indexOf("\n}", open));
}

// `.dark` sits on <html> beside `:root`, so its declarations override the light
// ones and every `var()` alias resolves against the merged set.
function tokensFor(css: string, theme: "light" | "dark"): (name: string) => string {
  const declared = new Map<string, string>();
  const blocks = theme === "light" ? [":root"] : [":root", ".dark"];

  for (const block of blocks) {
    for (const [, name, value] of blockFor(css, block).matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
      declared.set(name!, value!.trim());
    }
  }

  return function resolve(name): string {
    const value = declared.get(name);
    expect(value, `${theme} ${name} is not declared`).toBeDefined();
    const alias = /^var\((--[a-z-]+)\)$/.exec(value!);

    return alias ? resolve(alias[1]!) : value!;
  };
}

function luminance(hex: string): number {
  expect(hex, "palette tokens are six-digit hex").toMatch(/^#[0-9a-f]{6}$/i);

  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;

    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi! + 0.05) / (lo! + 0.05);
};

const THEMES: Array<"light" | "dark"> = ["light", "dark"];

test.each(THEMES)("%s: focus rings clear 3:1 on every surface", async (theme) => {
  const token = tokensFor(await Bun.file(GLOBALS).text(), theme);

  for (const edge of ["--ring", "--sidebar-ring"]) {
    for (const surface of ["--background", "--card", "--muted", "--sidebar"]) {
      const ratio = contrast(token(edge), token(surface));
      expect(
        Number(ratio.toFixed(2)),
        `${theme} ${edge} on ${surface} is ${ratio.toFixed(2)}:1, below the 3:1 floor`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

test.each(THEMES)("%s: muted and state text clear 4.5:1 on every surface", async (theme) => {
  const token = tokensFor(await Bun.file(GLOBALS).text(), theme);

  const pairs = [
    ...["--background", "--card", "--muted"].map((surface) => ["--muted-foreground", surface]),
    ["--stamp", "--stamp-soft"],
    ["--warn", "--warn-soft"],
    ["--danger", "--danger-soft"],
  ];

  for (const [text, surface] of pairs) {
    const ratio = contrast(token(text!), token(surface!));
    expect(
      Number(ratio.toFixed(2)),
      `${theme} ${text} on ${surface} is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});
