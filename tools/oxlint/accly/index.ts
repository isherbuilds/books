import { eslintCompatPlugin } from "@oxlint/plugins";

import { clientSafeImportsRule } from "./rules/client-safe-imports.ts";
import { noApiUrlLiteralRule } from "./rules/no-api-url-literal.ts";
import { noExposureSideBranchRule } from "./rules/no-exposure-side-branch.ts";
import { noPaiseArithmeticInComponentsRule } from "./rules/no-paise-arithmetic-in-components.ts";
import { noPermissionInHandlerRule } from "./rules/no-permission-in-handler.ts";
import { noRawPaiseSumRule } from "./rules/no-raw-paise-sum.ts";
import { pagingFromOrpcRule } from "./rules/paging-from-orpc.ts";
import { queryOptionsInLibRule } from "./rules/query-options-in-lib.ts";
import { writeErrorsViaHandlerRule } from "./rules/write-errors-via-handler.ts";
import { noBigintInComponentsRule } from "./rules/no-bigint-in-components.ts";
import { noManualMemoRule } from "./rules/no-manual-memo.ts";
import { noMotionOnControlsRule } from "./rules/no-motion-on-controls.ts";
import { noPassThroughFunctionRule } from "./rules/no-pass-through-function.ts";

/** Project-owned Oxlint rules. Kept out of `anti-slop/`, which is vendored upstream. */
const acclyPlugin = eslintCompatPlugin({
  meta: { name: "accly" },
  rules: {
    "client-safe-imports": clientSafeImportsRule,
    "no-api-url-literal": noApiUrlLiteralRule,
    "no-exposure-side-branch": noExposureSideBranchRule,
    "no-paise-arithmetic-in-components": noPaiseArithmeticInComponentsRule,
    "no-permission-in-handler": noPermissionInHandlerRule,
    "no-raw-paise-sum": noRawPaiseSumRule,
    "paging-from-orpc": pagingFromOrpcRule,
    "query-options-in-lib": queryOptionsInLibRule,
    "write-errors-via-handler": writeErrorsViaHandlerRule,
    "no-bigint-in-components": noBigintInComponentsRule,
    "no-manual-memo": noManualMemoRule,
    "no-motion-on-controls": noMotionOnControlsRule,
    "no-pass-through-function": noPassThroughFunctionRule,
  },
});

export default acclyPlugin;
