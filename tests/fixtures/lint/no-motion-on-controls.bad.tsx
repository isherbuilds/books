import { cn } from "@accly/ui/lib/utils";

const fieldBase = "rounded-md border transition-colors";
let rowBase = "flex items-center transition-opacity";

export function Field({ busy }: { busy: boolean }) {
  return (
    <>
      <input className={cn(fieldBase, busy && "hover:duration-150", "[transition:opacity_1s]")} />
      <Label wrapperClassName="flex transition-all" />
      <Select classNames={{ trigger: "rounded-md animate-pulse" }} />
      <Checkbox className={(state) => (state.checked ? "bg-primary duration-200" : "bg-muted")} />
      <div className={rowBase} />
    </>
  );
}
