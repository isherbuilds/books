import { cn } from "@accly/ui/lib/utils";

const fieldBase = "rounded-md border transition-colors";

export function Field({ busy }: { busy: boolean }) {
  return (
    <input className={cn(fieldBase, busy && "hover:duration-150", "[transition:opacity_1s]")} />
  );
}
