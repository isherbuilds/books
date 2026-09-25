export type CreateItem = { __create: string };

/** A Link Field shows at most this many matches; typing narrows to the rest. */
export const LINK_ROW_LIMIT = 8;

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
 * equals the committed label, so the list opens unfiltered, as Midday's pickers do,
 * with the committed value first: a keyboard commit then keeps it, even when it lies
 * past the limit. A typed name that already exists gets no Create row; Create is
 * otherwise always last.
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

    return [selected, ...all.filter((item) => getKey(item) !== key)].slice(0, LINK_ROW_LIMIT);
  }

  const matches = all.slice(0, LINK_ROW_LIMIT);

  if (!canCreate || needle === "") return matches;

  const lower = needle.toLowerCase();
  const exists = all.some((item) => getLabel(item).trim().toLowerCase() === lower);

  return exists ? matches : [...matches, { __create: needle }];
}
