import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

/**
 * Ban a function whose whole body forwards its own parameters, unchanged and in
 * order, to one plain function: `const f = (a, b) => g(a, b)`. It adds a name and a hop, not
 * behaviour. Call `g` directly, or give the wrapper real work.
 *
 * Only a named wrapper is checked: a function declaration or a variable initialised with
 * a function. An inline callback is left alone, because its caller may pass more
 * arguments than it forwards: `xs.map((s) => parseInt(s))` pins the arity where
 * `xs.map(parseInt)` would not, and Base UI calls `onValueChange(value, eventDetails)`.
 * An `async` wrapper is not reported either: it turns a synchronous throw into a
 * rejection, so it is not a pure pass-through.
 */
function isForwarding(node: FunctionNode): boolean {
  const { params, parent } = node;
  if (node.async) return false;
  if (node.type !== "FunctionDeclaration" && parent.type !== "VariableDeclarator") return false;
  if (params.length === 0 || params.some((param) => param.type !== "Identifier")) return false;
  let call = node.body;
  if (call?.type === "BlockStatement") {
    const [only] = call.body;
    if (call.body.length !== 1 || only?.type !== "ReturnStatement") return false;
    call = only.argument;
  }
  if (
    call?.type !== "CallExpression" ||
    call.callee.type !== "Identifier" ||
    call.arguments.length !== params.length
  )
    return false;
  return call.arguments.every((arg, index) => {
    const param = params[index];
    return arg.type === "Identifier" && param?.type === "Identifier" && arg.name === param.name;
  });
}

export const noPassThroughFunctionRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow functions that only forward their parameters to one call." },
    messages: {
      passThrough:
        "This function only forwards its parameters to another call. Call the target directly, or delete the wrapper.",
    },
  },
  createOnce(context) {
    const check = (node: FunctionNode) => {
      if (isForwarding(node)) context.report({ node, messageId: "passThrough" });
    };
    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
    };
  },
});
