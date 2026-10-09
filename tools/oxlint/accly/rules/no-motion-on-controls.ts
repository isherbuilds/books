import { defineRule } from "@oxlint/plugins";

/**
 * Frequent actions do not animate (docs/design.md §11): buttons, toggles, fields and
 * checkboxes change state without a transition. Only overlays enter and exit with
 * motion; they are exempted by file in `.oxlintrc.json`. `transition-none`,
 * `animate-none` and the `animate-spin` loader are fine anywhere.
 */
const MOTION = /^(transition(?!-none$)|duration-|delay-|animate-(?!none$|spin$))/;

function motionClass(text) {
  return text.split(/\s+/).find((token) => MOTION.test(token.slice(token.lastIndexOf(":") + 1)));
}

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
    const check = (node, text) => {
      const token = motionClass(text);
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
