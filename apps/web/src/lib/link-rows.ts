export type CreateItem = { __create: string };

export function isCreateItem<T>(item: T | CreateItem): item is CreateItem {
  return typeof item === "object" && item !== null && "__create" in item;
}

/** Prefix matches on the label or code first, then substring matches. */
function filterLinkItems<T>(
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
 * The rows a Link Field shows. Untouched text equals the committed label, so the
 * whole list opens with the current record checked, as Midday's pickers do. A typed
 * name that already exists gets no Create row; Create is otherwise always last.
 */
export function linkRows<T>({
  items,
  query,
  selectedLabel,
  canCreate,
  getLabel,
  getCode,
}: {
  items: T[];
  query: string;
  selectedLabel: string;
  canCreate: boolean;
  getLabel: (item: T) => string;
  getCode?: (item: T) => string | undefined;
}): Array<T | CreateItem> {
  const needle = query === selectedLabel ? "" : query.trim();
  const matches = filterLinkItems(items, needle, getLabel, getCode);

  if (!canCreate || needle === "") return matches;

  const lower = needle.toLowerCase();
  const exists = matches.some((item) => getLabel(item).trim().toLowerCase() === lower);

  return exists ? matches : [...matches, { __create: needle }];
}
