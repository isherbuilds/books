import { orpc } from "@/lib/orpc";
import { handleWriteError } from "@/lib/orpc-error";

export const options = (settle: () => Promise<void>) =>
  orpc.item.setActive.mutationOptions({
    onError: (error) =>
      handleWriteError(error, { settle, fallback: "Could not update the item", uncertain: null }),
  });
