import { Button } from "@accly/ui/components/button";
import { SheetBody, SheetFooter } from "@accly/ui/components/sheet";
import { useId, type FormEvent, type ReactNode, type SyntheticEvent } from "react";
import { get, useFormState, type Control, type FieldPath, type FieldValues } from "react-hook-form";

// React bubbles portal events through the tree, so a stacked quick-create Sheet's
// keys and submit would reach this form; only events from its own DOM count.
const ownEvent = (event: SyntheticEvent<HTMLFormElement>) =>
  event.target instanceof Node && event.currentTarget.contains(event.target);

const FOCUSABLE = 'input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Spec §5: Enter moves to the next field, never to a button (Tab still reaches them). A
// Link Field with its popup open owns the key (it commits the highlighted match), so
// only a closed control moves focus.
function focusNext(form: HTMLFormElement, current: HTMLElement) {
  const controls = [...form.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      !element.matches(":disabled") && element.offsetParent !== null && element.tabIndex !== -1,
  );

  const next = controls[controls.indexOf(current) + 1];

  next?.focus();
}

/** Mod+Enter submits; plain Enter moves to the next field and never submits. */
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
        } else if (
          event.target instanceof HTMLInputElement &&
          event.target.getAttribute("aria-expanded") !== "true"
        ) {
          event.preventDefault();
          focusNext(event.currentTarget, event.target);
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <fieldset disabled={pending} className="contents">
        <SheetBody className="gap-3 text-xs">{children}</SheetBody>
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
      <SheetBody className="grid place-content-center gap-3 text-center text-xs">
        <p className="text-muted-foreground">Posted</p>
        <p className="font-mono text-sm font-medium">{number}</p>
        {children}
      </SheetBody>
      <PostBar onClose={onDone} closeLabel="Done">
        <Button type="button" onClick={onNext}>
          Post and next
        </Button>
      </PostBar>
    </div>
  );
}

export function FieldArrayError<TFieldValues extends FieldValues>({
  control,
  name,
}: {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
}) {
  const { errors } = useFormState({ control, name, exact: true });
  // A `superRefine` on the array lands on `root`; a `min`/`max` issue on the field itself.
  const message: unknown = get(errors, `${name}.root.message`) ?? get(errors, `${name}.message`);

  return typeof message === "string" ? (
    <p role="alert" className="text-destructive">
      {message}
    </p>
  ) : null;
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
