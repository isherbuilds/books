import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

const INITIAL_RECT = { width: 1024, height: 600 };

const OVERSCAN = 10;

/** The paging slice of a `useInfiniteQuery` result; the query object itself fits. */
export type VirtualPage = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => void;
};

const DESKTOP_QUERY = "(min-width: 48rem)";

const subscribeDesktop = (listener: () => void) => {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", listener);

  return () => media.removeEventListener("change", listener);
};

/**
 * Whether the `md` table layout is showing: `undefined` on the server and during
 * hydration, so both the table and the cards render (CSS picks one) exactly as the
 * server sent them; after hydration only the active layout mounts and fetches.
 */
export function useDesktop(): boolean | undefined {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => undefined,
  );
}

/** Rows in the PageBody scroller. Place padding elements around virtualRows. */
export function useVirtualRows<TList extends HTMLElement, TItem extends Element = TList>({
  count,
  estimateSize,
  getItemKey,
  enabled = true,
  nextPage,
}: {
  count: number;
  estimateSize: number;
  getItemKey: (index: number) => string;
  enabled?: boolean;
  nextPage?: VirtualPage;
}) {
  const listRef = useRef<TList>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const virtualizer = useVirtualizer<HTMLDivElement, TItem>({
    count,
    getScrollElement: () =>
      listRef.current?.closest<HTMLDivElement>('[data-slot="page-body"]') ?? null,
    estimateSize: () => estimateSize,
    getItemKey,
    overscan: OVERSCAN,
    initialRect: INITIAL_RECT,
    scrollMargin,
    enabled,
  });

  useLayoutEffect(() => {
    if (!enabled) return;
    const list = listRef.current;
    const scroller = list?.closest<HTMLDivElement>('[data-slot="page-body"]');

    if (!list || !scroller) return;

    const measureOffset = () => {
      setScrollMargin(
        list.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
      );
    };

    measureOffset();
    // A wrapping toolbar or a summary strip can move the list without resizing the scroller.
    const observer = new ResizeObserver(measureOffset);

    for (
      let element: Element | null = list;
      element && element !== scroller;
      element = element.parentElement
    ) {
      for (
        let sibling = element.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      ) {
        observer.observe(sibling);
      }
    }

    observer.observe(scroller);

    return () => observer.disconnect();
  }, [enabled]);

  const virtualRows = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualizer.range?.endIndex;
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = nextPage ?? {};

  useEffect(() => {
    if (
      enabled &&
      lastVisibleIndex !== undefined &&
      lastVisibleIndex >= count - 1 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError
    ) {
      fetchNextPage?.();
    }
  }, [
    enabled,
    lastVisibleIndex,
    count,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  const first = virtualRows[0];
  const last = virtualRows.at(-1);

  return {
    listRef,
    virtualRows,
    paddingTop: first ? first.start - scrollMargin : 0,
    paddingBottom: last ? Math.max(0, virtualizer.getTotalSize() - (last.end - scrollMargin)) : 0,
    measureElement: virtualizer.measureElement,
    scrollToIndex: virtualizer.scrollToIndex,
  };
}
