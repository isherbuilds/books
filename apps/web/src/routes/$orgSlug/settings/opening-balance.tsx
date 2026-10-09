import { formatMoney, isPositiveMoney } from "@accly/api/core/money";
import { formatBusinessDate, formatBusinessDay } from "@accly/api/lib/business-date";
import { documentLabel } from "@accly/api/lib/document-labels";
import type { AppRouterClient } from "@accly/api/routers/index";
import { APPLY_CREDIT_GRANT } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { Separator } from "@accly/ui/components/separator";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";

import { ApplyCreditDialog } from "@/components/apply-credit-dialog";
import { ReasonDialog } from "@/components/confirm-dialog";
import { DATA_TABLE_FEATURES, DataTable } from "@/components/data-table/data-table";
import { DetailRow } from "@/components/detail-row";
import { OpeningBalanceForm } from "@/components/opening-balance-form";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { PostedLines } from "@/components/posted-lines";
import { WaveLoader } from "@/components/wave-loader";
import { invalidateOpeningBalanceState } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { openingBalanceOptions, openingItemsOptions } from "@/lib/opening-balance";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { handleWriteError } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

export const Route = createFileRoute("/$orgSlug/settings/opening-balance")({
  head: () => ({ meta: [{ title: "Opening balance · Accly Books" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { openingBalance: ["read"] });
    await Promise.all([
      queryClient.query(openingBalanceOptions(orgSlug)).catch(() => {}),
      queryClient.infiniteQuery(openingItemsOptions(orgSlug)).catch(() => {}),
    ]);
  },
  component: OpeningBalanceRoute,
});

function OpeningBalanceRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();
  const canPost = useCan(orgSlug, { openingBalance: ["post"] });
  const canCancel = useCan(orgSlug, { openingBalance: ["cancel"] });
  const canApply = useCan(orgSlug, APPLY_CREDIT_GRANT);
  const openingBalance = useQuery(openingBalanceOptions(orgSlug));
  const openingItems = useInfiniteQuery(openingItemsOptions(orgSlug));
  const items = openingItems.data?.pages.flatMap((page) => page.rows) ?? [];
  const [cancelOpen, setCancelOpen] = useState(false);
  const [applying, setApplying] = useState<OpeningItem | null>(null);

  const columns = canApply
    ? [...OPENING_ITEM_COLUMNS, applyColumn(setApplying)]
    : OPENING_ITEM_COLUMNS;

  const cancel = useMutation(
    orpc.openingBalance.cancel.mutationOptions({
      onSuccess: async () => {
        await invalidateOpeningBalanceState(queryClient, orgSlug);
        setCancelOpen(false);
        toast.success("Opening balance cancelled");
      },
      onError: (error) =>
        handleWriteError(error, {
          settle: () => {
            setCancelOpen(false);

            return invalidateOpeningBalanceState(queryClient, orgSlug);
          },
          fallback: "Could not cancel the opening balance",
          uncertain: "The result is uncertain. Reload the page before cancelling it again.",
        }),
    }),
  );

  const document = openingBalance.data;

  return (
    <>
      <PageHeader
        title="Opening balance"
        description="Opening ledger balances on the cutover date."
        action={
          document && canCancel ? (
            <Button variant="destructive" onClick={() => setCancelOpen(true)}>
              Cancel opening balance
            </Button>
          ) : undefined
        }
      />
      <SettingsTabs orgSlug={orgSlug} />
      {openingBalance.isError ? (
        <PageBody>
          <ErrorNote title="Could not load the opening balance" error={openingBalance.error} />
        </PageBody>
      ) : document ? (
        <PageBody>
          <div className="grid gap-4">
            <h2 className="font-mono text-base font-medium tabular-nums">{document.number}</h2>

            <dl className="grid max-w-2xl gap-3">
              <DetailRow label="As at">{formatBusinessDate(document.documentDate)}</DetailRow>
              <DetailRow label="Posted on">{formatDate(document.postedAt, timeZone)}</DetailRow>
              <DetailRow label="Total">{formatMoney(document.totalPaise)}</DetailRow>
            </dl>

            <Separator />

            <PostedLines lines={document.lines} />
            {items.length > 0 || openingItems.isError ? (
              <section className="grid grid-cols-1 gap-2">
                <h3 className="min-h-6 text-muted-foreground">Opening items</h3>
                <DataTable
                  columns={columns}
                  data={items}
                  getRowId={(item) => item.id}
                  meta={{ orgSlug }}
                  renderCard={(item) => (
                    <OpeningItemCard item={item} onApply={canApply ? setApplying : undefined} />
                  )}
                  query={openingItems}
                  errorTitle="Could not load the opening items"
                  empty={null}
                />
              </section>
            ) : null}
          </div>
        </PageBody>
      ) : openingBalance.isPending ? (
        <PageBody>
          <WaveLoader label="Loading opening balance" className="m-auto" />
        </PageBody>
      ) : canPost ? (
        <OpeningBalanceForm orgSlug={orgSlug} />
      ) : (
        <PageBody>
          <p className="text-muted-foreground">No opening balance posted</p>
        </PageBody>
      )}

      {document ? (
        <ReasonDialog
          open={cancelOpen}
          pending={cancel.isPending}
          title="Cancel opening balance"
          description="This reverses the balance on its original cutover date, changing historical balances. The original remains in the audit history."
          placeholder="Why is this opening balance being cancelled?"
          keepLabel="Keep opening balance"
          confirmLabel="Cancel opening balance"
          pendingLabel="Cancelling…"
          onClose={() => setCancelOpen(false)}
          onConfirm={(reason) => cancel.mutate({ orgSlug, openingBalanceId: document.id, reason })}
        />
      ) : null}

      {applying ? (
        <ApplyCreditDialog
          orgSlug={orgSlug}
          side={applying.exposureSide}
          target={{
            id: applying.id,
            partyId: applying.partyId,
            number: applying.number,
            outstandingPaise: applying.balancePaise,
          }}
          onClose={() => setApplying(null)}
        />
      ) : null}
    </>
  );
}

type OpeningItem = Awaited<ReturnType<AppRouterClient["openingBalance"]["items"]>>["rows"][number];

const col = createColumnHelper<typeof DATA_TABLE_FEATURES, OpeningItem>();

// The server orders items by legacy date; no header sorts.
const OPENING_ITEM_COLUMNS = [
  col.accessor("number", {
    header: "Number",
    meta: { className: "w-32" },
    cell: ({ getValue }) => <span className="font-mono">{getValue()}</span>,
  }),
  col.accessor("partyName", {
    header: "Party",
    cell: ({ getValue }) => <span className="capitalize">{getValue()}</span>,
  }),
  col.accessor("type", {
    header: "Type",
    meta: { className: "hidden w-36 xl:table-cell" },
    cell: ({ row: { original } }) => documentLabel(original.type, original.exposureSide),
  }),
  col.accessor("reference", {
    header: "Reference",
    meta: { className: "hidden w-28 2xl:table-cell" },
  }),
  // Legacy items usually predate this year, so most rows carry the full date.
  col.accessor("documentDate", {
    header: "Date",
    meta: { className: "w-28" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatBusinessDay(getValue())}</span>,
  }),
  col.accessor("dueDate", {
    header: "Due date",
    meta: { className: "hidden w-28 2xl:table-cell" },
    cell: ({ getValue }) => {
      const dueDate = getValue();

      return <span className="tabular-nums">{dueDate ? formatBusinessDay(dueDate) : "—"}</span>;
    },
  }),
  col.accessor("totalPaise", {
    header: "Amount",
    meta: { align: "right", className: "w-money" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatMoney(getValue())}</span>,
  }),
  col.accessor("balancePaise", {
    header: "Balance",
    meta: { align: "right", className: "w-balance" },
    cell: ({ getValue }) => <span className="tabular-nums">{formatMoney(getValue())}</span>,
  }),
];

/** Only an open claim takes a credit; an opening credit is applied from its claim. */
const canTakeCredit = (item: OpeningItem) =>
  item.type === "openingClaim" && isPositiveMoney(item.balancePaise);

function applyColumn(onApply: (item: OpeningItem) => void) {
  return col.display({
    id: "apply",
    header: () => <span className="sr-only">Actions</span>,
    meta: { className: "w-32" },
    cell: ({ row: { original } }) =>
      canTakeCredit(original) ? (
        <Button variant="outline" size="sm" onClick={() => onApply(original)}>
          Apply credit
        </Button>
      ) : null,
  });
}

function OpeningItemCard({
  item,
  onApply,
}: {
  item: OpeningItem;
  onApply?: (item: OpeningItem) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono font-medium">{item.number}</span>
        <span className="tabular-nums">{formatMoney(item.totalPaise)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-muted-foreground">
        <span className="min-w-0 truncate capitalize">{item.partyName}</span>
        <span className="tabular-nums">Balance {formatMoney(item.balancePaise)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-muted-foreground">
        <span className="min-w-0 truncate">
          {documentLabel(item.type, item.exposureSide)} · {item.reference}
        </span>
        <span className="tabular-nums">{formatBusinessDay(item.documentDate)}</span>
      </div>
      {onApply && canTakeCredit(item) ? (
        <Button variant="outline" size="sm" className="self-start" onClick={() => onApply(item)}>
          Apply credit
        </Button>
      ) : null}
    </>
  );
}
