// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7.
// Row, empty-state and "Create" composition adapted from
// packages/ui/src/components/{combobox-dropdown,combobox,command}.tsx, on Base UI.

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@accly/ui/components/combobox";
import { Input } from "@accly/ui/components/input";
import { ClientOnly } from "@tanstack/react-router";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useState, type KeyboardEvent, type Ref } from "react";

import { isCreateItem, linkRows, type CreateItem } from "@/lib/link-rows";
import { useTabCommit } from "@/hooks/use-tab-commit";
import { errorReason } from "@/lib/orpc-error";
import { WaveLoader } from "@/components/wave-loader";

type LinkStatus = "pending" | "error" | "overflow" | "ready";

type LinkFieldProps<T> = {
  items: T[] | undefined;
  /** The master-list query behind `items`; its state picks the empty-row copy. */
  query: { isPending: boolean; isError: boolean; error: unknown };
  /** The records in the plural, for status copy: "parties", "income accounts". */
  noun: string;
  /**
   * False while `items` may miss a match: a master past its bound, or a server
   * search still catching up with the text. It withholds Create and "No matches".
   */
  complete?: boolean;
  /** The typed text, trimmed; empty while the field shows its committed value. */
  onSearch?: (needle: string) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  /** An identifier matched by prefix and shown right-aligned, such as a GSTIN. */
  getCode?: (item: T) => string | undefined;
  /** Muted context beside the label, such as the city. */
  getDescription?: (item: T) => string | undefined;
  value: T | null;
  onSelect: (item: T | null) => void;
  onCreate?: (seed: string) => void;
  /** An optional field: emptied text plus Enter or Tab clears it. */
  clearable?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Focus on mount, for a field that remounts while its Sheet stays open. */
  autoFocus?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
};

// Design §9: the empty row says what would be here.
function statusText(status: LinkStatus, noun: string, needle: string, canCreate: boolean) {
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
  complete = true,
  onSearch,
  getKey,
  getLabel,
  getCode,
  getDescription,
  value,
  onSelect,
  onCreate,
  clearable,
  placeholder,
  inputRef,
  autoFocus,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-required": ariaRequired,
}: LinkFieldProps<T>) {
  const status: LinkStatus = listQuery.isPending
    ? "pending"
    : !listQuery.isError
      ? "ready"
      : errorReason(listQuery.error) === "MASTER_LIST_LIMIT"
        ? "overflow"
        : "error";

  const selectedLabel = value ? getLabel(value) : "";
  // Text typed since the last commit; null shows the committed value, so an external
  // selection change (reset, post-and-next) shows at once.
  const [typed, setTyped] = useState<string | null>(null);
  const query = typed ?? selectedLabel;
  const [open, setOpen] = useState(false);
  const canCreate = onCreate !== undefined && status === "ready" && complete;
  const needle = query === selectedLabel ? "" : query.trim();

  const rows = linkRows({
    items: status === "ready" ? (items ?? []) : [],
    query,
    selected: value,
    selectedLabel,
    canCreate,
    getKey,
    getLabel,
    getCode,
  });

  const changeQuery = (text: string) => {
    const untouched = text === selectedLabel;

    if (value && !untouched) onSelect(null);
    setTyped(untouched ? null : text);
    onSearch?.(untouched ? "" : text.trim());
  };

  const choose = (item: T | CreateItem) => {
    onSearch?.("");

    if (isCreateItem(item)) {
      onCreate?.(item.__create);
      setOpen(false);

      return;
    }

    setTyped(null);
    onSelect(item);
    setOpen(false);
  };

  const tabCommit = useTabCommit<T | CreateItem>({
    open,
    needle,
    isCommittable: (item) => !isCreateItem(item),
    commit: choose,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab" && event.key !== "Enter") return;

    const hasHighlighted = tabCommit.onKeyDown(event);

    if (clearable && value && !hasHighlighted && event.currentTarget.value.trim() === "") {
      onSelect(null);
    }
  };

  return (
    <ClientOnly
      fallback={
        <Input
          ref={inputRef}
          id={id}
          placeholder={placeholder}
          defaultValue={selectedLabel}
          aria-invalid={ariaInvalid}
          disabled
        />
      }
    >
      <Combobox<T | CreateItem>
        items={rows}
        filteredItems={rows}
        autoHighlight
        loopFocus
        value={value}
        isItemEqualToValue={(item, selected) =>
          !isCreateItem(item) && !isCreateItem(selected) && getKey(item) === getKey(selected)
        }
        itemToStringLabel={(item) =>
          isCreateItem(item) ? `Create “${item.__create}”` : getLabel(item)
        }
        inputValue={query}
        onInputValueChange={(next, details) => {
          if (details.reason === "escape-key" && value) {
            details.allowPropagation();
          } else if (details.reason !== "item-press") {
            changeQuery(next);
          }
        }}
        onValueChange={(item) => {
          if (item) choose(item);
        }}
        open={open}
        onOpenChange={setOpen}
        onItemHighlighted={tabCommit.onItemHighlighted}
      >
        <ComboboxInput
          ref={inputRef}
          id={id}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-required={ariaRequired}
          onKeyDown={handleKeyDown}
          onBlur={() => changeQuery(selectedLabel)}
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {status === "pending" || (status === "ready" && !complete) ? (
              <WaveLoader
                label={status === "pending" ? `Loading ${noun}` : `Searching ${noun}`}
                className="justify-center px-3 py-4"
              />
            ) : (
              <p className="px-3 py-4 text-center">{statusText(status, noun, needle, canCreate)}</p>
            )}
          </ComboboxEmpty>
          <ComboboxList>
            {(item: T | CreateItem) => {
              if (isCreateItem(item)) {
                return (
                  <ComboboxItem key={`__create:${item.__create}`} value={item}>
                    <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">Create “{item.__create}”</span>
                  </ComboboxItem>
                );
              }

              const description = getDescription?.(item);
              const code = getCode?.(item);

              return (
                <ComboboxItem key={getKey(item)} value={item}>
                  <CheckIcon className="invisible size-3.5 shrink-0 group-data-[selected]/combobox-item:visible" />
                  <span className="min-w-0 truncate">{getLabel(item)}</span>
                  {description ? (
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {description}
                    </span>
                  ) : null}
                  {code ? (
                    <span className="ml-auto shrink-0 font-mono text-muted-foreground">{code}</span>
                  ) : null}
                </ComboboxItem>
              );
            }}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </ClientOnly>
  );
}
