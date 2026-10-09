import { cn } from "@accly/ui/lib/utils";

const fieldBase = "rounded-md border transition-none duration-0 animate-spin";
const hint = "delay-loaded text";
const status = "Saved, then a transition.";
const phase = "transition";

export function Field({ busy }: { busy: boolean }) {
  return (
    <input
      title={status}
      placeholder={hint}
      data-phase={phase}
      className={cn(fieldBase, busy && "opacity-50")}
    />
  );
}
