import { normalizePhone } from "@accly/api/lib/phone";
import { Button } from "@accly/ui/components/button";
import { Combobox } from "@accly/ui/components/combobox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@accly/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { ErrorNote } from "@/components/page";
import { CustomerSheet } from "@/components/customer-sheet";
import { useDebouncedCallback } from "@/hooks/use-debounced-value";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { customerAgeLabel } from "@/lib/customer-age";

export type SelectedCustomer = { id: string; name: string; code: string };

const HAS_LETTERS = /\p{L}/u;

function phoneQuery(value: string) {
  const digits = normalizePhone(value);
  const hasLetters = HAS_LETTERS.test(value);

  return {
    isPhone: !hasLetters && digits.length >= 4,
    incomplete: !hasLetters && digits.length < 4,
  };
}

function callerSeed(value: string) {
  const classification = phoneQuery(value);

  if (classification.isPhone) return { phone: value };

  if (classification.incomplete) return {};

  return { name: value };
}

// Uncontrolled: the DOM holds what is typed and only the settled term becomes
// state, so a keystroke never re-renders this component.
function CustomerSearchInput({
  orgSlug,
  initialQuery,
  inputRef,
  onSelect,
  onRegister,
}: {
  orgSlug: string;
  initialQuery?: string;
  inputRef: { current: HTMLInputElement | null };
  onSelect: (customer: SelectedCustomer) => void;
  onRegister: (seed: { name?: string; phone?: string }) => void;
}) {
  const { today } = useOrgDateTime();
  const [search, setSearch] = useState(() => initialQuery?.trim() ?? "");
  const [open, setOpen] = useState(false);
  const settle = useDebouncedCallback(setSearch, 300);
  const { isPhone, incomplete } = phoneQuery(search);

  const results = useQuery({
    ...orpc.customer.search.queryOptions({
      input: isPhone
        ? { orgSlug, phone: search, limit: 20 }
        : { orgSlug, query: search, limit: 20 },
    }),
    enabled: search.length > 0 && !incomplete,
  });

  const matches = results.data?.items ?? [];
  const searched = !incomplete && search.length > 0 && results.isSuccess;
  const error = results.isError ? results.error : null;

  const typed = () => inputRef.current?.value.trim() ?? search;

  const openRegistration = () => {
    setOpen(false);
    onRegister(callerSeed(typed()));
  };

  const renderMatch = (match: (typeof matches)[number]) => {
    const age = customerAgeLabel(match.dateOfBirth, match.dobEstimated, today);

    return (
      <>
        <span className="min-w-0">
          <span className="block truncate font-medium">{match.name}</span>
          <span className="block truncate text-muted-foreground">
            {match.code} · <span className="font-mono tabular-nums">{match.phone}</span>
          </span>
        </span>
        <span className="shrink-0 capitalize text-muted-foreground">
          {age}y · {match.sex}
        </span>
      </>
    );
  };

  return (
    <>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Combobox
          items={matches}
          getItemKey={(match) => match.id}
          getItemLabel={(match) => match.name}
          defaultInputValue={initialQuery}
          onInputValueChange={(value) => settle.schedule(value.trim())}
          onSelect={(match) => {
            setOpen(false);
            onSelect({ id: match.id, name: match.name, code: match.code });
          }}
          open={open}
          onOpenChange={setOpen}
          inputRef={inputRef}
          inputClassName="pl-8"
          inputProps={{
            id: "customer-search",
            "aria-label": "Phone or name",
            placeholder: "Phone or name",
            autoComplete: "off",
            autoFocus: true,
            onFocus: () => {
              if (typed().length > 0) setOpen(true);
            },
            onKeyDown: (event) => {
              if (event.key !== "Enter" || !searched || matches.length > 0) return;
              event.preventDefault();
              openRegistration();
            },
          }}
          itemClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-none border-b border-border px-3 py-2 last:border-b-0"
          renderItem={renderMatch}
          emptyContent={
            results.isPending && !incomplete && search.length > 0 ? (
              <p className="px-3 py-2 text-muted-foreground">Searching…</p>
            ) : searched ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No customer matches “{search}”</EmptyTitle>
                  <EmptyDescription>No existing record uses these details.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" onClick={openRegistration}>
                    Register new customer
                  </Button>
                </EmptyContent>
              </Empty>
            ) : undefined
          }
        />
      </div>

      {error ? <ErrorNote title="Could not search customers" error={error} /> : null}
    </>
  );
}

export function OpdCustomerSearch({
  orgSlug,
  initialQuery,
  onSelect,
}: {
  orgSlug: string;
  initialQuery?: string;
  onSelect: (customer: SelectedCustomer) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [seed, setSeed] = useState<{ name?: string; phone?: string } | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <CustomerSearchInput
        orgSlug={orgSlug}
        initialQuery={initialQuery}
        inputRef={searchRef}
        onSelect={onSelect}
        onRegister={setSeed}
      />

      <CustomerSheet
        orgSlug={orgSlug}
        seed={seed ?? undefined}
        open={seed !== null}
        onOpenChange={() => {
          setSeed(null);
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        onRegistered={(customer) => {
          setSeed(null);
          onSelect(customer);
        }}
      />
    </div>
  );
}
