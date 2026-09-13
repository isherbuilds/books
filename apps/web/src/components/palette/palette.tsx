// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// (apps/dashboard/src/components/search/{search-modal,search,search-footer,open-search-button}.tsx),
// rebuilt on cmdk + Base UI Dialog, oRPC, TanStack Router and Accly's route action registry.

import { formatMoney } from "@accly/api/core/money";
import { authorize } from "@accly/auth/access";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@accly/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  createDialogHandle,
} from "@accly/ui/components/dialog";
import { Kbd } from "@accly/ui/components/kbd";
import { SidebarMenuButton, useSidebar } from "@accly/ui/components/sidebar";
import { cn } from "@accly/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  Building2Icon,
  ContactRoundIcon,
  CornerDownLeftIcon,
  CornerUpRightIcon,
  ReceiptIndianRupeeIcon,
  SearchIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type RefObject } from "react";

import { useRegisteredPaletteActions } from "@/components/palette/use-palette-actions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMembership } from "@/lib/membership";
import { PRIMARY_NAV, SETTINGS_TABS } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";
import { rankCommands, type PaletteGroup, type PaletteItem } from "@/lib/palette";
import { partyListOptions } from "@/lib/parties";

// The palette and the sidebar trigger both render inside ClientOnly, so this
// module-level handle never binds during SSR.
const paletteHandle = createDialogHandle();

const GROUP_LABELS: Record<PaletteGroup, string> = {
  action: "Actions",
  go: "Navigation",
  organization: "Organizations",
  party: "Parties",
  receipt: "Receipts",
};

const GROUP_ICONS: Record<PaletteGroup, LucideIcon> = {
  action: CornerUpRightIcon,
  go: ArrowRightIcon,
  organization: Building2Icon,
  party: ContactRoundIcon,
  receipt: ReceiptIndianRupeeIcon,
};

export function Palette({ orgSlug }: { orgSlug: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Mod+K from anywhere, text fields included; pressed again it closes the palette.
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;

      event.preventDefault();

      if (paletteHandle.isOpen) paletteHandle.close();
      else paletteHandle.open(null);
    };

    window.addEventListener("keydown", toggle);

    return () => window.removeEventListener("keydown", toggle);
  }, []);

  return (
    <Dialog handle={paletteHandle}>
      {/* Pinned at the top, not centred, so the input stays put while results change. */}
      <DialogContent
        initialFocus={inputRef}
        showCloseButton={false}
        className="top-16 max-w-2xl translate-y-0 gap-0 overflow-hidden p-0 data-open:animate-none data-closed:animate-none sm:top-24"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        {/* The portal unmounts the body on close, which resets the query. */}
        <PaletteBody key={orgSlug} orgSlug={orgSlug} inputRef={inputRef} />
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({
  orgSlug,
  inputRef,
}: {
  orgSlug: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const navigate = useNavigate();
  const actions = useRegisteredPaletteActions();
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const organizations = useMembership(orgSlug, (membership) => membership.organizations);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const debouncedQuery = useDebouncedValue(typed, 200);
  const canReadParties = authorize(roles, { party: ["read"] });
  const canReadReceipts = authorize(roles, { receipt: ["read"] });

  const partyQuery = useQuery({ ...partyListOptions(orgSlug), enabled: canReadParties });

  const receiptQuery = useQuery({
    ...orpc.receipt.list.queryOptions({ input: { orgSlug, q: debouncedQuery, limit: 8 } }),
    enabled: canReadReceipts && debouncedQuery.length > 0,
    // Keeps the last rows while the next search fetches, so the group does not blink.
    // Safe because the body remounts per organization, the key carries orgSlug, and
    // rankCommands drops every retained row that no longer matches the input.
    placeholderData: keepPreviousData,
  });

  // Settings destinations join once the operator types, so the opening list stays short.
  const goItems = [...PRIMARY_NAV, ...(typed ? SETTINGS_TABS : [])].flatMap(
    (entry): PaletteItem[] =>
      authorize(roles, entry.permission)
        ? [
            {
              id: `go:${entry.to}`,
              label: `Go to ${entry.label}`,
              group: "go",
              icon: "icon" in entry ? entry.icon : SettingsIcon,
              run: () => void navigate({ to: entry.to, params: { orgSlug } }),
            },
          ]
        : [],
  );

  // Creating works from any page; a route that registers the same action id wins,
  // because it opens the form in place.
  const createItems = [
    ...(authorize(roles, { receipt: ["post"] })
      ? [
          {
            id: "receipt:new",
            label: "New receipt",
            group: "action" as const,
            run: () =>
              void navigate({
                to: "/$orgSlug/receipts",
                params: { orgSlug },
                search: { create: true },
              }),
          },
        ]
      : []),
    ...(authorize(roles, { party: ["create"] })
      ? [
          {
            id: "party:new",
            label: "New party",
            group: "action" as const,
            run: () =>
              void navigate({
                to: "/$orgSlug/parties",
                params: { orgSlug },
                search: { create: true },
              }),
          },
        ]
      : []),
  ].filter((item) => !actions.some((action) => action.id === item.id));

  const organizationItems = organizations
    .filter((organization) => organization.slug !== orgSlug)
    .map((organization): PaletteItem => ({
      id: `organization:${organization.id}`,
      label: `Switch to ${organization.name}`,
      group: "organization",
      run: () =>
        void navigate({ to: "/$orgSlug/dashboard", params: { orgSlug: organization.slug } }),
    }));

  const partyItems = typed
    ? (partyQuery.data ?? []).map((party): PaletteItem => ({
        id: `party:${party.id}`,
        label: party.name,
        group: "party",
        detail: party.gstin ?? undefined,
        hint: party.active ? undefined : "Inactive",
        keywords: [party.gstin, party.phone, party.email].filter((value) => value !== null),
        run: () =>
          void navigate({
            to: "/$orgSlug/parties/$partyId",
            params: { orgSlug, partyId: party.id },
          }),
      }))
    : [];

  // keepPreviousData also returns the last rows for a disabled query: an emptied
  // input shows no receipts.
  const receiptItems =
    typed && debouncedQuery
      ? (receiptQuery.data?.rows ?? []).map((receipt): PaletteItem => ({
          id: `receipt:${receipt.id}`,
          label: receipt.number ?? "—",
          group: "receipt",
          detail: receipt.partyName ?? undefined,
          hint: receipt.state === "cancelled" ? "Cancelled" : formatMoney(receipt.totalPaise),
          // The server also matches the Party and the reference; the ranker must too.
          keywords: [receipt.partyName, receipt.reference].filter((value) => value !== null),
          run: () =>
            void navigate({
              to: "/$orgSlug/receipts/$receiptId",
              params: { orgSlug, receiptId: receipt.id },
            }),
        }))
      : [];

  const sections = rankCommands(
    [...actions, ...createItems, ...goItems, ...organizationItems, ...partyItems, ...receiptItems],
    typed,
  );

  const searching =
    sections.length === 0 &&
    canReadReceipts &&
    typed.length > 0 &&
    (typed !== debouncedQuery || receiptQuery.isFetching);

  return (
    <Command label="Command palette" shouldFilter={false} loop vimBindings={false}>
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder="Type a command or search…"
      />
      <CommandList>
        <CommandEmpty>
          {searching ? "Searching receipts…" : `No results for “${typed}”.`}
        </CommandEmpty>
        {sections.map(({ group, items }, index) => (
          <Fragment key={group}>
            {/* cmdk hides a separator while the input has text unless told otherwise;
                this palette ranks its own rows, so the groups it shows are final. */}
            {index > 0 ? <CommandSeparator alwaysRender /> : null}
            <CommandGroup heading={GROUP_LABELS[group]}>
              {items.map((item) => (
                <PaletteRow
                  key={item.id}
                  item={item}
                  onSelect={() => {
                    item.run();
                    paletteHandle.close();
                  }}
                />
              ))}
            </CommandGroup>
          </Fragment>
        ))}
      </CommandList>
      {/* Always mounted and outside the listbox, so the text change is announced. */}
      <p role="status" className="sr-only">
        {searching ? "Searching receipts…" : ""}
      </p>
      <PaletteFooter />
    </Command>
  );
}

function PaletteRow({ item, onSelect }: { item: PaletteItem; onSelect: () => void }) {
  const Icon = item.icon ?? GROUP_ICONS[item.group];

  return (
    <CommandItem value={item.id} onSelect={onSelect}>
      <Icon />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("min-w-0 truncate", item.group === "receipt" && "font-mono")}>
          {item.label}
        </span>
        {item.detail ? (
          <span
            className={cn("truncate text-muted-foreground", item.group === "party" && "font-mono")}
          >
            {item.detail}
          </span>
        ) : null}
      </span>
      {item.hint ? (
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{item.hint}</span>
      ) : null}
    </CommandItem>
  );
}

function PaletteFooter() {
  return (
    <div className="flex h-10 shrink-0 items-center justify-end border-t border-border px-4 text-muted-foreground pointer-coarse:hidden">
      <div aria-hidden className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          Navigate
          <Kbd>
            <ArrowUpIcon />
          </Kbd>
          <Kbd>
            <ArrowDownIcon />
          </Kbd>
        </span>
        <span className="flex items-center gap-1">
          Open
          <Kbd>
            <CornerDownLeftIcon />
          </Kbd>
        </span>
        <span className="flex items-center gap-1">
          Close
          <Kbd>Esc</Kbd>
        </span>
      </div>
    </div>
  );
}

export function PaletteTrigger() {
  const { setOpenMobile } = useSidebar();

  return (
    <DialogTrigger
      handle={paletteHandle}
      render={<SidebarMenuButton className="text-muted-foreground" />}
      // On a phone the rail is a Sheet: close it, or it stays open under the palette.
      onClick={() => setOpenMobile(false)}
    >
      <SearchIcon />
      <span className="min-w-0 flex-1 truncate">Find anything…</span>
      <Kbd className="pointer-coarse:hidden">⌘K</Kbd>
    </DialogTrigger>
  );
}
