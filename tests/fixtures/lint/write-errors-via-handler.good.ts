import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/lib/orpc";
import { handleWriteError } from "@/lib/orpc-error";

export const options = (settle: () => Promise<void>) =>
  orpc.item.setActive.mutationOptions({
    onError: (error) =>
      handleWriteError(error, { settle, fallback: "Could not update the item", uncertain: null }),
  });

// A download is a read: a plain useMutation may toast.
export const download = () =>
  useMutation({ mutationFn: async () => {}, onError: (error) => toast.error(error.message) });
