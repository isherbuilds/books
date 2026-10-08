import { eslintCompatPlugin } from "@oxlint/plugins";

import { noBigintInComponentsRule } from "./rules/no-bigint-in-components.ts";
import { noMotionOnControlsRule } from "./rules/no-motion-on-controls.ts";
import { noPassThroughFunctionRule } from "./rules/no-pass-through-function.ts";

/** Project-owned Oxlint rules. Kept out of `anti-slop/`, which is vendored upstream. */
const acclyPlugin = eslintCompatPlugin({
  meta: { name: "accly" },
  rules: {
    "no-bigint-in-components": noBigintInComponentsRule,
    "no-motion-on-controls": noMotionOnControlsRule,
    "no-pass-through-function": noPassThroughFunctionRule,
  },
});

export default acclyPlugin;
