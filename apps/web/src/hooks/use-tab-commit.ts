import { useRef, type KeyboardEvent } from "react";

/** Forward Tab commits only a typed, selectable highlight; Enter remains the combobox's own action. */
export function useTabCommit<T>({
  open,
  needle,
  isCommittable,
  commit,
}: {
  open: boolean;
  needle: string;
  isCommittable: (item: T) => boolean;
  commit: (item: T) => void;
}) {
  const highlighted = useRef<T | undefined>(undefined);

  return {
    onItemHighlighted: (item: T | undefined) => {
      highlighted.current = item;
    },
    clearHighlight: () => {
      highlighted.current = undefined;
    },
    // Return whether an item was highlighted for callers with additional Enter handling.
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      const item = open ? highlighted.current : undefined;

      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        needle &&
        item !== undefined &&
        isCommittable(item)
      ) {
        commit(item);
      }

      return item !== undefined;
    },
  };
}
