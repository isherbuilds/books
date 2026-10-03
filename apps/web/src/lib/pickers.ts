import type { AppRouterClient } from "@accly/api/routers/index";
import { skipToken } from "@tanstack/react-query";

import { keysetPaging, orpc } from "@/lib/orpc";

type PickerInput<Picker extends "openItems" | "openCredits"> = Omit<
  Parameters<AppRouterClient["party"][Picker]>[0],
  "cursor" | "limit"
>;

/** A party's open claims on one side, one small page at a time. */
export const openItemsOptions = (input: PickerInput<"openItems"> | typeof skipToken) =>
  orpc.party.openItems.infiniteOptions({
    input: input === skipToken ? skipToken : (cursor: string | undefined) => ({ ...input, cursor }),
    ...keysetPaging,
  });

/** A party's unapplied credits on one side, one small page at a time; `q` searches numbers and references. */
export const openCreditsOptions = (input: PickerInput<"openCredits"> | typeof skipToken) =>
  orpc.party.openCredits.infiniteOptions({
    input: input === skipToken ? skipToken : (cursor: string | undefined) => ({ ...input, cursor }),
    ...keysetPaging,
  });
