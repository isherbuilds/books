import { searchQuery } from "@accly/api/lib/schemas";
import { Badge } from "@accly/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ScrollTextIcon } from "lucide-react";
import { z } from "zod";

import {
  ListFooter,
  ListState,
  ListToolbar,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { useVirtualRows } from "@/components/data-table/use-virtual-rows";
import { PeriodMenu } from "@/components/date-range-filter";
import { orpc } from "@/lib/orpc";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";
import { periodSearch } from "@/lib/require-period";

import { SettingsTabs } from "./route";

const auditSearch = z.object({
  q: searchQuery.catch(undefined),
  ...periodSearch,
});

// `staleTime: 0`: every sensitive mutation writes here, so the trail refetches on
// every entry rather than relying on each mutation to invalidate it.

const auditQuery = (orgSlug: string, filters: Omit<z.infer<typeof auditSearch>, "all">) =>
  orpc.audit.list.infiniteOptions({
    input: (cursor: number | undefined) => ({
      orgSlug,
      cursor,
      ...filters,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  });

const ACTION_LABELS: Record<string, string> = {
  "account.setActive": "Account status changed",
  "allocation.apply": "Amount applied",
  "allocation.reverse": "Applied amount undone",
  "bill.amend": "Bill amended",
  "bill.cancel": "Bill cancelled",
  "bill.post": "Bill posted",
  "creditNote.cancel": "Credit note cancelled",
  "creditNote.post": "Credit note posted",
  "debitNote.cancel": "Debit note cancelled",
  "debitNote.post": "Debit note posted",
  "file.delete": "File deleted",
  "file.read": "File opened",
  "file.upload": "File uploaded",
  "import.commit": "Workbook imported",
  "invoice.amend": "Invoice amended",
  "invoice.cancel": "Invoice cancelled",
  "invoice.post": "Invoice posted",
  "journal.cancel": "Journal cancelled",
  "journal.post": "Journal posted",
  "lock.grantException": "Lock exception granted",
  "lock.revokeException": "Lock exception revoked",
  "lock.set": "Period lock changed",
  "member.invite": "Member invited",
  "member.invite.revoke": "Invitation cancelled",
  "member.join": "Member joined",
  "member.remove": "Member removed",
  "member.role.update": "Member role changed",
  "openingBalance.cancel": "Opening balance cancelled",
  "openingBalance.post": "Opening balance posted",
  "organization.create": "Organization created",
  "payment.cancel": "Payment cancelled",
  "payment.post": "Payment posted",
  "rbac.permission": "Permission check",
  "receipt.cancel": "Receipt cancelled",
  "receipt.post": "Receipt posted",
  "settings.update": "Settings updated",
};

function describeTarget(target: string | null, meta: Record<string, unknown> | null): string {
  if (!target) return "—";

  if (target.startsWith("email:")) return target.slice("email:".length);

  if (typeof meta?.sourceNumber === "string" && typeof meta.targetNumber === "string") {
    return `${meta.sourceNumber} → ${meta.targetNumber}`;
  }

  for (const key of ["sourceNumber", "targetNumber", "number", "name", "email", "slug"]) {
    const label = meta?.[key];

    if (typeof label === "string") return label;
  }

  if (target.startsWith("periodLock:") && typeof meta?.kind === "string") {
    return `${meta.kind === "tax" ? "Tax" : "General"} period`;
  }

  const type = target.split(":")[0]!.replace(/([a-z])([A-Z])/g, "$1 $2");

  return type[0]!.toUpperCase() + type.slice(1);
}

function describeMeta(meta: Record<string, unknown> | null): string {
  const details = Object.entries(meta ?? {})
    .filter(([key, value]) => !/Ids?$/.test(key) && value != null)
    .map(([key, value]) => {
      const label = key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\btds\b/gi, "TDS")
        .replace(/\bgstin\b/gi, "GSTIN");

      return `${label[0]!.toUpperCase()}${label.slice(1)}: ${
        typeof value === "string" ? value : JSON.stringify(value)
      }`;
    });

  return details.join(" · ") || "—";
}

export const Route = createFileRoute("/$orgSlug/settings/audit")({
  head: () => ({ meta: [{ title: "Audit log · Accly Books" }] }),
  validateSearch: auditSearch,
  loaderDeps: ({ search: { all: _all, ...filters } }) => filters,
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { audit: ["read"] });
    await queryClient.infiniteQuery(auditQuery(orgSlug, deps)).catch(() => {});
  },
  component: AuditRoute,
});

function AuditRoute() {
  const { orgSlug } = Route.useParams();
  const { timeZone } = useOrgDateTime();
  const { all: _all, ...filters } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const setFilters = (patch: Partial<z.infer<typeof auditSearch>>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const audit = useInfiniteQuery(auditQuery(orgSlug, filters));

  const entries = audit.data?.pages.flatMap((page) => page.items) ?? [];

  const virtual = useVirtualRows<HTMLTableSectionElement, HTMLTableRowElement>({
    count: entries.length,
    estimateSize: 72,
    getItemKey: (index) => String(entries[index]!.id),
    nextPage: audit,
  });

  return (
    <>
      <PageHeader
        title="Audit"
        description="Sensitive actions and every permission denial in this organization"
      />
      <SettingsTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search by person or document number"
            placeholder="Person or document number"
            value={filters.q}
            onQueryChange={(q) => void setFilters({ q: q || undefined })}
          />
          <PeriodMenu range={filters} onChange={(range) => void setFilters(range)} />
        </ListToolbar>

        <Panel label="Entries" footer={<ListFooter query={audit} shown={entries.length} />}>
          <ListState
            query={audit}
            errorTitle="Could not load the audit trail"
            isEmpty={entries.length === 0}
            empty={
              <span className="flex flex-col items-center gap-2">
                <ScrollTextIcon className="size-5" />
                <p className="max-w-sm">No audit entries found</p>
              </span>
            }
          >
            {/* At desktop content widths, reserve space for Details rather than
                letting a long file key claim the entire row. Scroll on mobile. */}
            <Table className="min-w-4xl table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">When</TableHead>
                  <TableHead className="w-36">Who</TableHead>
                  <TableHead className="w-44">What happened</TableHead>
                  <TableHead className="w-48">On</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody ref={virtual.listRef}>
                {virtual.paddingTop > 0 ? (
                  <TableRow aria-hidden style={{ height: virtual.paddingTop }}>
                    <TableCell colSpan={5} className="p-0" />
                  </TableRow>
                ) : null}
                {virtual.virtualRows.map((item) => {
                  const entry = entries[item.index]!;
                  const details = describeMeta(entry.meta);

                  return (
                    <TableRow key={entry.id} data-index={item.index} ref={virtual.measureElement}>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDateTime(entry.createdAt, timeZone)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.actorName ? (
                          <>
                            <div className="truncate text-foreground">{entry.actorName}</div>
                            <div className="truncate">{entry.actorEmail}</div>
                          </>
                        ) : (
                          // The account is gone; the entry deliberately survives it.
                          <span className="break-all font-mono">{entry.actorId}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium" title={entry.action}>
                            {ACTION_LABELS[entry.action] ??
                              entry.action.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll(".", " ")}
                          </span>
                          {entry.denied && <Badge variant="danger">Denied</Badge>}
                        </span>
                      </TableCell>
                      {/* The original id remains available on hover for investigations;
                          the row itself shows the business identifier where known. */}
                      <TableCell
                        className="break-words text-muted-foreground"
                        title={entry.target ?? undefined}
                      >
                        {describeTarget(entry.target, entry.meta)}
                      </TableCell>
                      {/* Prose, not an identifier, so no mono. It wraps: the
                          amounts and numbers here are why someone opens the log. */}
                      <TableCell className="break-words text-muted-foreground">{details}</TableCell>
                    </TableRow>
                  );
                })}
                {virtual.paddingBottom > 0 ? (
                  <TableRow aria-hidden style={{ height: virtual.paddingBottom }}>
                    <TableCell colSpan={5} className="p-0" />
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}
