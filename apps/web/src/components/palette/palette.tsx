// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// (apps/dashboard/src/components/search/{search-modal,search,search-footer,open-search-button}.tsx),
// rebuilt on cmdk + Base UI Dialog, oRPC, TanStack Router and Accly's route action registry.

import { formatMoney } from "@accly/api/core/money";
import { authorize, type AppPermission } from "@accly/auth/access";
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
  createDialogHandle,
} from "@accly/ui/components/dialog";
import { Kbd } from "@accly/ui/components/kbd";
import { cn } from "@accly/ui/lib/utils";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate, type NavigateOptions } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  Building2Icon,
  ContactRoundIcon,
  CornerDownLeftIcon,
  CornerUpRightIcon,
  FileDiffIcon,
  FileInputIcon,
  FileTextIcon,
  HandCoinsIcon,
  HouseIcon,
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

// The palette renders inside ClientOnly and its trigger only calls `open`, so this
// module-level handle never binds during SSR.
const paletteHandle = createDialogHandle();

/** Below this, a remote search matches most of the table, so it is not worth a round trip. */
const MIN_SEARCH_CHARS = 2;

/** The palette is for recognising a row, not browsing: more rows only cost time. */
const SEARCH_RESULT_LIMIT = 4;

const GROUP_LABELS: Record<PaletteGroup, string> = {
  action: "Actions",
  go: "Navigation",
  organization: "Organizations",
  party: "Parties",
  document: "Documents",
};

// A record form opens from its list's `?create=true`; a line grid has its own page.
const CREATE_ACTIONS: readonly {
  id: string;
  label: string;
  to:
    | "/$orgSlug/receipts"
    | "/$orgSlug/invoices/new"
    | "/$orgSlug/bills/new"
    | "/$orgSlug/payments"
    | "/$orgSlug/parties";
  permission: AppPermission;
}[] = [
  {
    id: "receipt:new",
    label: "New receipt",
    to: "/$orgSlug/receipts",
    permission: { receipt: ["post"] },
  },
  {
    id: "invoice:new",
    label: "New invoice",
    to: "/$orgSlug/invoices/new",
    permission: { invoice: ["create"] },
  },
  {
    id: "bill:new",
    label: "New bill",
    to: "/$orgSlug/bills/new",
    permission: { bill: ["create"] },
  },
  {
    id: "payment:new",
    label: "New payment",
    to: "/$orgSlug/payments",
    permission: { payment: ["post"] },
  },
  {
    id: "party:new",
    label: "New party",
    to: "/$orgSlug/parties",
    permission: { party: ["create"] },
  },
];

const STATE_LABELS = { draft: "Draft", posted: "Posted", cancelled: "Cancelled" } as const;

const GROUP_ICONS: Record<PaletteGroup, LucideIcon> = {
  action: CornerUpRightIcon,
  go: ArrowRightIcon,
  organization: Building2Icon,
  party: ContactRoundIcon,
  document: FileTextIcon,
};

// Every register the palette searches by number, Party or reference. The calls made
// in one tick travel as one batched request, so five registers cost one round trip.
const DOCUMENT_SEARCHES = [
  {
    kind: "Invoice",
    icon: FileTextIcon,
    permission: { invoice: ["read"] } satisfies AppPermission,
    options: (orgSlug: string, q: string) =>
      orpc.invoice.list.queryOptions({ input: { orgSlug, q, limit: SEARCH_RESULT_LIMIT } }),
    open: (orgSlug: string, id: string): NavigateOptions => ({
      to: "/$orgSlug/invoices/$invoiceId",
      params: { orgSlug, invoiceId: id },
    }),
  },
  {
    kind: "Receipt",
    icon: ReceiptIndianRupeeIcon,
    permission: { receipt: ["read"] } satisfies AppPermission,
    options: (orgSlug: string, q: string) =>
      orpc.receipt.list.queryOptions({ input: { orgSlug, q, limit: SEARCH_RESULT_LIMIT } }),
    open: (orgSlug: string, id: string): NavigateOptions => ({
      to: "/$orgSlug/receipts/$receiptId",
      params: { orgSlug, receiptId: id },
    }),
  },
  {
    kind: "Bill",
    icon: FileInputIcon,
    permission: { bill: ["read"] } satisfies AppPermission,
    options: (orgSlug: string, q: string) =>
      orpc.bill.list.queryOptions({ input: { orgSlug, q, limit: SEARCH_RESULT_LIMIT } }),
    open: (orgSlug: string, id: string): NavigateOptions => ({
      to: "/$orgSlug/bills/$billId",
      params: { orgSlug, billId: id },
    }),
  },
  {
    kind: "Payment",
    icon: HandCoinsIcon,
    permission: { payment: ["read"] } satisfies AppPermission,
    options: (orgSlug: string, q: string) =>
      orpc.payment.list.queryOptions({ input: { orgSlug, q, limit: SEARCH_RESULT_LIMIT } }),
    open: (orgSlug: string, id: string): NavigateOptions => ({
      to: "/$orgSlug/payments/$paymentId",
      params: { orgSlug, paymentId: id },
    }),
  },
  {
    kind: "Note",
    icon: FileDiffIcon,
    permission: { note: ["read"] } satisfies AppPermission,
    options: (orgSlug: string, q: string) =>
      orpc.note.list.queryOptions({ input: { orgSlug, q, limit: SEARCH_RESULT_LIMIT } }),
    open: (orgSlug: string, id: string): NavigateOptions => ({
      to: "/$orgSlug/notes/$noteId",
      params: { orgSlug, noteId: id },
    }),
  },
];

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
  const searches = DOCUMENT_SEARCHES.filter(({ permission }) => authorize(roles, permission));
  const searchReady = debouncedQuery.length >= MIN_SEARCH_CHARS;

  const partyQuery = useQuery({ ...partyListOptions(orgSlug), enabled: canReadParties });

  const documentQueries = useQueries({
    queries: searches.map((search) => ({
      ...search.options(orgSlug, debouncedQuery),
      enabled: searchReady,
    })),
  });

  // Settings destinations join once the operator types, so the opening list stays short.
  const home: PaletteItem = {
    id: "go:home",
    label: "Go to Home",
    group: "go",
    icon: HouseIcon,
    run: () => void navigate({ to: "/$orgSlug", params: { orgSlug } }),
  };

  // Two note links share a path, so the label keys a row.
  const goItems = [home].concat(
    [...PRIMARY_NAV, ...(typed ? SETTINGS_TABS : [])].flatMap((entry): PaletteItem[] =>
      authorize(roles, entry.permission)
        ? [
            {
              id: `go:${entry.label}`,
              label: `Go to ${entry.label}`,
              group: "go",
              icon: "icon" in entry ? entry.icon : SettingsIcon,
              run: () =>
                void navigate({
                  to: entry.to,
                  params: { orgSlug },
                  search: "noteType" in entry ? { type: entry.noteType } : undefined,
                }),
            },
          ]
        : [],
    ),
  );

  // Creating works from any page; a route that registers the same action id wins,
  // because it opens the form in place.
  const createItems = CREATE_ACTIONS.flatMap((create): PaletteItem[] =>
    authorize(roles, create.permission) && !actions.some((action) => action.id === create.id)
      ? [
          {
            id: create.id,
            label: create.label,
            group: "action",
            run: () =>
              void (create.to === "/$orgSlug/invoices/new" || create.to === "/$orgSlug/bills/new"
                ? navigate({ to: create.to, params: { orgSlug } })
                : navigate({ to: create.to, params: { orgSlug }, search: { create: true } })),
          },
        ]
      : [],
  );

  const organizationItems = organizations
    .filter((organization) => organization.slug !== orgSlug)
    .map((organization): PaletteItem => ({
      id: `organization:${organization.id}`,
      label: `Switch to ${organization.name}`,
      group: "organization",
      run: () => void navigate({ to: "/$orgSlug", params: { orgSlug: organization.slug } }),
    }));

  const partyItems = typed
    ? (partyQuery.data ?? []).map((party): PaletteItem => ({
        id: `party:${party.id}`,
        label: party.name,
        group: "party",
        detail: party.gstin ?? undefined,
        hint: party.active ? undefined : "Inactive",
        keywords: party.gstin ? [party.gstin] : [],
        run: () =>
          void navigate({
            to: "/$orgSlug/parties/$partyId",
            params: { orgSlug, partyId: party.id },
          }),
      }))
    : [];

  const documentItems =
    typed && searchReady
      ? searches.flatMap((search, index) =>
          (documentQueries[index]?.data?.rows ?? []).map((row): PaletteItem => ({
            id: `document:${row.id}`,
            label: row.number ?? "Draft",
            group: "document",
            icon: search.icon,
            detail: [search.kind, row.partyName].filter(Boolean).join(" · "),
            hint: row.state === "posted" ? formatMoney(row.totalPaise) : STATE_LABELS[row.state],
            // The server also matches the Party and the reference; the ranker must too.
            keywords: [
              search.kind,
              row.partyName,
              "reference" in row ? row.reference : null,
            ].filter((value) => typeof value === "string"),
            run: () => void navigate(search.open(orgSlug, row.id)),
          })),
        )
      : [];

  const sections = rankCommands(
    [...actions, ...createItems, ...goItems, ...organizationItems, ...partyItems, ...documentItems],
    typed,
  );

  const searching =
    sections.length === 0 &&
    searches.length > 0 &&
    typed.length >= MIN_SEARCH_CHARS &&
    (typed !== debouncedQuery || documentQueries.some((query) => query.isFetching));

  return (
    <Command label="Command palette" shouldFilter={false} loop vimBindings={false}>
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder="Type a command or search…"
      />
      <CommandList>
        <CommandEmpty>{searching ? "Searching…" : `No results for “${typed}”.`}</CommandEmpty>
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
        {searching ? "Searching…" : ""}
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
        <span className={cn("min-w-0 truncate", item.group === "document" && "font-mono")}>
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

// A plain button, so the rail server-renders it; the Dialog mounts on the client.
export function PaletteTrigger({ className, onOpen }: { className: string; onOpen?: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className={cn(className, "bg-muted text-muted-foreground")}
      onClick={() => {
        // The mobile menu closes itself, or it stays open under the palette.
        onOpen?.();
        paletteHandle.open(null);
      }}
    >
      <SearchIcon />
      <span className="min-w-0 flex-1 truncate">Find anything…</span>
      <Kbd className="bg-background pointer-coarse:hidden">⌘K</Kbd>
    </button>
  );
}
