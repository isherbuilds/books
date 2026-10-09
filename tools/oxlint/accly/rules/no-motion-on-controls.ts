import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/**
 * Frequent actions do not animate (docs/design.md §11): buttons, toggles, fields and
 * checkboxes change state without a transition. Only overlays enter and exit with
 * motion; they are exempted by file in `.oxlintrc.json`. `transition-none`,
 * `duration-0`, `animate-none` and the `animate-spin` loader are fine anywhere.
 *
 * Only class lists are read: a `className`/`class`/`*ClassName` attribute (including a
 * Base UI `className={(state) => ...}` function), the values of a `classNames` object,
 * the arguments of a class helper (`cn`, `cva`, `clsx`, `cx`, `tv`, `twMerge`) and a
 * variable initialised with a plain string, which is how a shared class list such as
 * `controlBase` is declared. Such a variable counts only with class-list evidence: two or
 * more tokens, or a name containing "class". The tokens must be real Tailwind utilities,
 * so prose like "delay-loaded" never matches, and a variable holding a sentence (capitals
 * or punctuation) is not a class list. Inline `style={{ transition }}` is out of scope:
 * the rule is about classes.
 */
const CLASS_HELPERS = new Set(["cn", "cva", "clsx", "cx", "tv", "twMerge"]);
const CLASS_ATTRIBUTE = /^(?:class|className|classNames)$|ClassName$/;
const PROSE = /[A-Z]|[,.;?](?:\s|$)/;
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

function motionClass(text: string): string | undefined {
  return text
    .split(/\s+/)
    .find((token) => MOTION.test(token.replace(VARIANTS, "").replace(/^!|!$/g, "")));
}

function classAttribute(node: ESTree.Node | null | undefined): boolean {
  return (
    node?.type === "JSXAttribute" &&
    node.name.type === "JSXIdentifier" &&
    CLASS_ATTRIBUTE.test(node.name.name)
  );
}

/** Whether a string sits in a class list, judged from its nearest owning construct. */
function inClassList(node: ESTree.Node, text: string): boolean {
  let child = node;
  let parent = node.parent;
  if (parent?.type === "TemplateLiteral") [child, parent] = [parent, parent.parent];
  if (parent?.type === "VariableDeclarator")
    return (
      parent.init === child &&
      !PROSE.test(text) &&
      (text.trim().split(/\s+/).length >= 2 ||
        (parent.id.type === "Identifier" && /class/i.test(parent.id.name)))
    );
  while (parent) {
    if (parent.type === "JSXAttribute") return classAttribute(parent);
    if (
      parent.type === "CallExpression" &&
      parent.callee.type === "Identifier" &&
      CLASS_HELPERS.has(parent.callee.name)
    )
      return true;
    if (parent.type.includes("Function")) {
      const container = parent.parent;
      return container?.type === "JSXExpressionContainer" && classAttribute(container.parent);
    }
    if (parent.type === "JSXElement" || parent.type === "Program") return false;
    parent = parent.parent;
  }
  return false;
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
    const check = (node: ESTree.Node, text: string) => {
      const token = motionClass(text);
      if (token && inClassList(node, text))
        context.report({ node, messageId: "motion", data: { token } });
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
