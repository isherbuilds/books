export type CreateItem = { __create: string };

/** A Link Field shows at most this many matches; typing narrows to the rest. */
const LINK_ROW_LIMIT = 6;

export function isCreateItem<T>(item: T | CreateItem): item is CreateItem {
  return typeof item === "object" && item !== null && "__create" in item;
}

/** Prefix matches on the label or code first, then substring matches. */
export function filterLinkItems<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string,
  getCode?: (item: T) => string | undefined,
): T[] {
  const needle = query.toLowerCase();

  if (needle.length === 0) return items;

  const prefixes: T[] = [];
  const substrings: T[] = [];

  for (const item of items) {
    const label = getLabel(item).toLowerCase();
    const code = getCode?.(item)?.toLowerCase();
    const isPrefix = label.startsWith(needle) || code?.startsWith(needle) === true;

    if (isPrefix) prefixes.push(item);
    else if (label.includes(needle) || code?.includes(needle) === true) substrings.push(item);
  }

  return prefixes.concat(substrings);
}

/**
 * The rows a Link Field shows: the best `LINK_ROW_LIMIT` matches. Untouched text
 * equals the committed label, so the list opens with the committed value first: a
 * keyboard commit then keeps it, even when it lies past the limit. A typed name
 * that already exists gets no Create row; Create is otherwise always last.
 */
export function linkRows<T>({
  items,
  query,
  selected,
  selectedLabel,
  canCreate,
  getKey,
  getLabel,
  getCode,
}: {
  items: T[];
  query: string;
  selected: T | null;
  selectedLabel: string;
  canCreate: boolean;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getCode?: (item: T) => string | undefined;
}): Array<T | CreateItem> {
  const needle = query === selectedLabel ? "" : query.trim();

  const all = filterLinkItems(items, needle, getLabel, getCode);

  if (needle === "" && selected !== null) {
    const key = getKey(selected);
    const others = all.slice(0, LINK_ROW_LIMIT + 1).filter((item) => getKey(item) !== key);

    return [selected, ...others].slice(0, LINK_ROW_LIMIT);
  }

  const matches = all.slice(0, LINK_ROW_LIMIT);

  if (!canCreate || needle === "") return matches;

  const lower = needle.toLowerCase();
  const exists = all.some((item) => getLabel(item).trim().toLowerCase() === lower);

  return exists ? matches : [...matches, { __create: needle }];
}
