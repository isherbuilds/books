import { defineRule } from "@oxlint/plugins";

/**
 * Ban a function whose whole body forwards its own parameters, unchanged and in
 * order, to one plain function: `const f = (a, b) => g(a, b)`. It adds a name and a hop, not
 * behaviour. Call `g` directly, or give the wrapper real work. A callback argument is
 * exempt: `xs.map((s) => parseInt(s))` pins the arity, and `xs.map(parseInt)` would not.
 */
function isForwarding(node) {
  const params = node.params;
  if (node.parent?.type === "CallExpression" && node.parent.arguments.includes(node)) return false;
  if (params.length === 0 || params.some((param) => param.type !== "Identifier")) return false;
  let call = node.body;
  if (call.type === "BlockStatement") {
    const [only] = call.body;
    if (call.body.length !== 1 || only.type !== "ReturnStatement") return false;
    call = only.argument;
  }
  if (
    call?.type !== "CallExpression" ||
    call.callee.type !== "Identifier" ||
    call.arguments.length !== params.length
  )
    return false;
  return call.arguments.every(
    (arg, index) => arg.type === "Identifier" && arg.name === params[index].name,
  );
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
    const check = (node) => {
      if (isForwarding(node)) context.report({ node, messageId: "passThrough" });
    };
    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
    };
  },
});
