// The border and invalid state shared by every text-entry control. The border rests
// on the `line-2` hairline and darkens to `line-strong` under the pointer or focus.
// Input, Textarea and NativeSelect must not drift apart: a field that highlights
// differently from the one beside it reads as a different kind of field. Text is
// 16 px on phones so iOS does not zoom on focus, 14 px from `md`.
export const controlBase =
  "rounded-md border border-input bg-card text-base outline-none placeholder:text-muted-foreground hover:border-line-strong focus-visible:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 md:text-sm aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";
