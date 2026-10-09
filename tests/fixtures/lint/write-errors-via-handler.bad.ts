import { toast } from "sonner";

import { orpc } from "@/lib/orpc";

export const options = orpc.item.setActive.mutationOptions({
  onError: (error) => toast.error(error.message),
});

export const multi = orpc.item.setActive.mutationOptions({
  onError: (error) => {
    console.warn(error);
    toast.error(error.message);
  },
});
