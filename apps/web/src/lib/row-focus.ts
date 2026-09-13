import type { KeyboardEvent } from "react";

// A row renders twice (table row and card, one hidden by breakpoint), so only the
// visible copies count.
function visibleRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-row-id]")].filter(
    (row) => row.getClientRects().length > 0,
  );
}

/**
 * Puts keyboard focus back on the list row a record Sheet came from. A row outside
 * the rendered window has no link, and focus stays where it is.
 */
export function focusRowLink(id: string): void {
  visibleRows()
    .find((row) => row.dataset.rowId === id)
    ?.querySelector<HTMLElement>("[data-row-link]")
    ?.focus();
}

/**
 * ↑/↓ inside an open record Sheet opens the adjacent visible list row. Keys that
 * React bubbles from a portaled child (the cancel dialog's reason box) are not the
 * Sheet's, and a record the list does not show has no neighbour.
 */
export function stepRow(
  event: KeyboardEvent<HTMLElement>,
  id: string,
  open: (id: string) => void,
): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  if (event.defaultPrevented || !(event.target instanceof Node)) return;

  if (!event.currentTarget.contains(event.target)) return;

  const rows = visibleRows();
  const index = rows.findIndex((row) => row.dataset.rowId === id);

  if (index === -1) return;

  const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)]?.dataset.rowId;

  if (!next) return;

  event.preventDefault();
  open(next);
}
