import { Button } from "@accly/ui/components/button";
import { Kbd } from "@accly/ui/components/kbd";
import { SheetBody, SheetFooter } from "@accly/ui/components/sheet";
import { useId, type ReactNode, type SubmitEvent, type SyntheticEvent } from "react";
import { get, useFormState, type Control, type FieldPath, type FieldValues } from "react-hook-form";

// React bubbles portal events through the tree, so a stacked quick-create Sheet's
// keys and submit would reach this form; only events from its own DOM count.
const ownEvent = (event: SyntheticEvent<HTMLFormElement>) =>
  event.target instanceof Node && event.currentTarget.contains(event.target);

// Base UI buttons carry `tabindex="0"`; Enter must reach fields, never a button.
const FOCUSABLE = 'input, select, textarea, [tabindex]:not([tabindex="-1"]):not(button)';

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

// A text field or a Base UI checkbox moves on; a checkbox's own Enter would click the
// form's default button, so it must not reach it. A textarea keeps its newline, a
// button its activation, and a Link Field with its popup open commits its match.
function movesOnEnter(target: EventTarget): target is HTMLElement {
  if (target instanceof HTMLInputElement) return target.getAttribute("aria-expanded") !== "true";

  return target instanceof HTMLElement && target.getAttribute("role") === "checkbox";
}

// A page-hosted form stops at a readable width; a Sheet is narrower already.
const COLUMN = "mx-auto w-full max-w-4xl";

/** Mod+Enter submits; plain Enter moves to the next field and never submits. */
export function DocumentForm({
  pending,
  onSubmit,
  children,
  footer,
}: {
  pending: boolean;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
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
        } else if (movesOnEnter(event.target)) {
          event.preventDefault();
          focusNext(event.currentTarget, event.target);
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <fieldset disabled={pending} className="contents">
        <SheetBody className="text-sm">
          <div className={`${COLUMN} grid gap-3`}>{children}</div>
        </SheetBody>
        {footer}
      </fieldset>
    </form>
  );
}

/** A form's footer: Close, any extra actions, then the submit button when `post` is given. */
export function PostBar({
  onClose,
  closeLabel = "Close",
  post,
  postLabel = "Post",
  children,
}: {
  onClose: () => void;
  closeLabel?: string;
  /** The post mutation's state; omit it when the viewer cannot post. */
  post?: { isPending: boolean; isError: boolean };
  postLabel?: string;
  children?: ReactNode;
}) {
  return (
    <SheetFooter>
      <div className={`${COLUMN} flex flex-wrap items-center justify-end gap-2`}>
        <Button type="button" variant="ghost" onClick={onClose}>
          {closeLabel}
        </Button>
        {children}
        {post ? (
          <Button type="submit">
            {post.isPending ? "Posting…" : post.isError ? "Post again" : postLabel}
            <Kbd>⌘↵</Kbd>
          </Button>
        ) : null}
      </div>
    </SheetFooter>
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
      {/* A block wrapper, so the grid does not stretch the button across the row. */}
      {actions ? <div>{actions}</div> : null}
    </section>
  );
}
