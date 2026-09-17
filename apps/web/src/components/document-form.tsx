import { Button } from "@accly/ui/components/button";
import { SheetFooter } from "@accly/ui/components/sheet";
import { useId, type FormEvent, type ReactNode, type SyntheticEvent } from "react";

// React bubbles portal events through the tree, so a stacked quick-create Sheet's
// keys and submit would reach this form; only events from its own DOM count.
const ownEvent = (event: SyntheticEvent<HTMLFormElement>) =>
  event.target instanceof Node && event.currentTarget.contains(event.target);

/** Mod+Enter submits; plain Enter in a field does not implicitly submit. Tab moves on. */
export function DocumentForm({
  pending,
  onSubmit,
  children,
  footer,
}: {
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();

        if (ownEvent(event) && !pending) onSubmit(event);
      }}
      onKeyDown={(event) => {
        if (!ownEvent(event) || event.key !== "Enter" || event.nativeEvent.isComposing) return;

        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        } else if (event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <fieldset disabled={pending} className="contents">
        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4">
          {children}
        </div>
        {footer}
      </fieldset>
    </form>
  );
}

export function PostBar({
  onClose,
  closeLabel,
  children,
}: {
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <SheetFooter>
      <Button type="button" variant="ghost" onClick={onClose}>
        {closeLabel}
      </Button>
      {children}
    </SheetFooter>
  );
}

/** What a document form shows once it posted: the number, Done, and Post and next. */
export function PostedView({
  number,
  onDone,
  onNext,
  children,
}: {
  number: string;
  onDone: () => void;
  onNext: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid flex-1 place-content-center gap-3 overflow-y-auto p-4 text-center">
        <p className="text-muted-foreground">Posted</p>
        <p className="font-mono text-sm font-medium">{number}</p>
        {children}
      </div>
      <PostBar onClose={onDone} closeLabel="Done">
        <Button type="button" onClick={onNext}>
          Post and next
        </Button>
      </PostBar>
    </div>
  );
}

export function LineGrid({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <h3 id={titleId} className="min-h-6 text-muted-foreground">
        {title}
      </h3>
      {children}
      {actions}
    </section>
  );
}
