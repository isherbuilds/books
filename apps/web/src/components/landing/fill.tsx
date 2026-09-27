/* Marks every "[bracketed]" run in plain copy as a placeholder the owner still
   has to supply, styled `.fill`. */
export function withFills(text: string) {
  return text.split(/(\[[^\]]+\])/).map((part, i) =>
    i % 2 ? (
      <span key={part} className="fill">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
