import { NON_NEGATIVE_MONEY_PATTERN, enteredPaise, isPositiveMoney } from "@accly/api/core/money";
import { z } from "zod";

// Form fields stay rupee text; the server's `money` fragment parses it once. Compared
// in paise, never through Number(), so no float ever judges an amount.
export const positiveAmount = z
  .string()
  .regex(NON_NEGATIVE_MONEY_PATTERN, "Enter a valid amount")
  .refine((value) => isPositiveMoney(enteredPaise(value)), "Amount must be greater than zero");
