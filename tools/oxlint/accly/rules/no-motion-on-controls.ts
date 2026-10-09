import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * Frequent actions do not animate (docs/design.md §11): buttons, toggles, fields and
 * checkboxes change state without a transition. Only overlays enter and exit with
 * motion; they are exempted by file in `.oxlintrc.json`. `transition-none`,
 * `duration-0`, `animate-none` and the `animate-spin` loader are fine anywhere.
 *
 * Every string and template part is split on whitespace and each token checked, so a
 * class list is caught wherever it is written. A lone word string that happens to equal
 * a utility (`"transition"`) is a rare false positive: disable inline with a reason.
 */
const VARIANTS = /^(?:(?:[^:[\]]|\[[^\]]*\])+:)*/;
const ARBITRARY = String.raw`\[[^\]]+\]|\([^)]+\)`;
const MOTION = new RegExp(
  [
    String.raw`^\[(?:transition|animation)[a-z-]*:(?!none\])`,
    String.raw`^transition(?:-(?:all|colors|opacity|shadow|transform|discrete|${ARBITRARY}))?$`,
    String.raw`^(?:duration|delay)-(?!0$)(?:\d+|initial|${ARBITRARY})$`,
    String.raw`^animate-(?!none$|spin$)(?:[a-z][a-z0-9-]*|${ARBITRARY})$`,
  ].join("|"),
);

export const noMotionOnControlsRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow transition and animation classes outside overlay components." },
    messages: {
      motion:
        "`{{token}}` animates a frequent control. Remove it (docs/design.md §11). Overlays that enter and exit belong in the `no-motion-on-controls` override in .oxlintrc.json.",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Node, text: string) => {
      const token = text
        .split(/\s+/)
        .find((part) => MOTION.test(part.replace(VARIANTS, "").replace(/^!|!$/g, "")));
      if (token) context.report({ node, messageId: "motion", data: { token } });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? "");
      },
    };
  },
});
