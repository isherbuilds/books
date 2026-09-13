// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7.
// Row, empty-state and "Create" composition adapted from
// packages/ui/src/components/{combobox-dropdown,combobox,command}.tsx, on Base UI.

import { Combobox } from "@accly/ui/components/combobox";
import { Input } from "@accly/ui/components/input";
import { ClientOnly } from "@tanstack/react-router";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";

import { isCreateItem, linkRows, type CreateItem } from "@/lib/link-rows";
import { errorReason } from "@/lib/orpc-error";

type LinkStatus = "pending" | "error" | "overflow" | "ready";

export type LinkFieldProps<T> = {
  items: T[] | undefined;
  /** The master-list query behind `items`; its state picks the empty-row copy. */
  query: { isPending: boolean; isError: boolean; error: unknown };
  /** The records in the plural, for status copy: "parties", "income accounts". */
  noun: string;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  /** An identifier matched by prefix and shown right-aligned, such as a GSTIN. */
  getCode?: (item: T) => string | undefined;
  /** Muted context beside the label, such as the city. */
  getDescription?: (item: T) => string | undefined;
  value: T | null;
  onSelect: (item: T | null) => void;
  onCreate?: (seed: string) => void;
  /** Called after an existing item is committed with Enter or click, so a form can advance focus. */
  onCommit?: () => void;
  /** An optional field: shows a clear button, and emptied text plus Enter or Tab clears it. */
  clearable?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

// Design §9: the empty row says what would be here.
function statusText(status: LinkStatus, noun: string, needle: string, canCreate: boolean) {
  if (status === "pending") return `Loading ${noun}…`;

  if (status === "error") return `Could not load ${noun}`;

  if (status === "overflow") {
    return `More than 5,000 ${noun}. Picking is unavailable until the list is smaller.`;
  }

  if (needle) return `No ${noun} match “${needle}”`;

  return canCreate ? `No ${noun} yet. Type a name to create one.` : `No ${noun} yet`;
}

export function LinkField<T>({
  items,
  query: listQuery,
  noun,
  getKey,
  getLabel,
  getCode,
  getDescription,
  value,
  onSelect,
  onCreate,
  onCommit,
  clearable,
  placeholder,
  inputRef,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: LinkFieldProps<T>) {
  const status: LinkStatus = listQuery.isPending
    ? "pending"
    : !listQuery.isError
      ? "ready"
      : errorReason(listQuery.error) === "MASTER_LIST_LIMIT"
        ? "overflow"
        : "error";

  const selectedLabel = value ? getLabel(value) : "";
  const [query, setQuery] = useState(() => selectedLabel);
  const [open, setOpen] = useState(false);
  const highlighted = useRef<T | CreateItem | undefined>(undefined);
  const canCreate = onCreate !== undefined && status === "ready";
  const needle = query === selectedLabel ? "" : query.trim();

  const rows = linkRows({
    items: status === "ready" ? (items ?? []) : [],
    query,
    selectedLabel,
    canCreate,
    getLabel,
    getCode,
  });

  const choose = (item: T | CreateItem, advance: boolean) => {
    if (isCreateItem(item)) {
      onCreate?.(item.__create);
      setOpen(false);

      return;
    }

    setQuery(getLabel(item));
    onSelect(item);
    setOpen(false);

    // Tab already moves focus natively; Enter and click hand off explicitly, after
    // Base UI has returned focus from the closing popup.
    if (advance && onCommit) requestAnimationFrame(onCommit);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab" && event.key !== "Enter") return;

    const item = open ? highlighted.current : undefined;

    // Tab commits an existing match, never Create, so it cannot open a panel.
    if (event.key === "Tab" && item !== undefined && !isCreateItem(item)) {
      choose(item, false);

      return;
    }

    if (clearable && value && item === undefined && event.currentTarget.value.trim() === "") {
      onSelect(null);
    }
  };

  // External selection changes (reset, post-and-next) rewrite the visible text.
  const selectedKey = value ? getKey(value) : "";
  useEffect(() => setQuery(selectedLabel), [selectedKey, selectedLabel]);

  return (
    <ClientOnly
      fallback={
        <div className="relative">
          <Input
            ref={inputRef}
            id={id}
            placeholder={placeholder}
            defaultValue={selectedLabel}
            aria-invalid={ariaInvalid}
            disabled
            className="pr-8"
          />
          <ChevronsUpDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      }
    >
      <Combobox<T | CreateItem>
        items={rows}
        getItemKey={(item) => (isCreateItem(item) ? `__create:${item.__create}` : getKey(item))}
        getItemLabel={(item) => (isCreateItem(item) ? `Create “${item.__create}”` : getLabel(item))}
        renderItem={(item) => {
          if (isCreateItem(item)) {
            return (
              <>
                <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Create “{item.__create}”</span>
              </>
            );
          }

          const description = getDescription?.(item);
          const code = getCode?.(item);

          return (
            <>
              <CheckIcon className="invisible size-3.5 shrink-0 group-data-selected/combobox-item:visible" />
              <span className="min-w-0 truncate">{getLabel(item)}</span>
              {description ? (
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{description}</span>
              ) : null}
              {code ? (
                <span className="ml-auto shrink-0 font-mono text-muted-foreground">{code}</span>
              ) : null}
            </>
          );
        }}
        onSelect={(item) => choose(item, true)}
        autoHighlight
        value={value}
        inputValue={query}
        onInputValueChange={setQuery}
        emptyContent={
          <p className="px-3 py-4 text-center">{statusText(status, noun, needle, canCreate)}</p>
        }
        open={open}
        onOpenChange={setOpen}
        showTrigger
        onClear={clearable ? () => onSelect(null) : undefined}
        onItemHighlighted={(item) => {
          highlighted.current = item;
        }}
        inputRef={inputRef}
        inputProps={{
          id,
          placeholder,
          autoComplete: "off",
          "aria-invalid": ariaInvalid,
          "aria-describedby": ariaDescribedBy,
          onKeyDown: handleKeyDown,
        }}
      />
    </ClientOnly>
  );
}
