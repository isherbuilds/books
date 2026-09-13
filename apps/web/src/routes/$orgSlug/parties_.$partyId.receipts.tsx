import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { DataTable } from "@/components/data-table/data-table";
import { TableEmpty } from "@/components/data-table/table-empty";
import { LoadMore } from "@/components/page";
import { RECEIPT_COLUMNS, ReceiptCard } from "@/components/receipt-columns";
import { OPERATIONAL_INFINITE_REFETCH } from "@/lib/operational-query";
import { receiptListOptions } from "@/lib/receipts";

export const Route = createFileRoute("/$orgSlug/parties_/$partyId/receipts")({
  loader: async ({ context: { queryClient }, params: { orgSlug, partyId } }) => {
    await queryClient.infiniteQuery(receiptListOptions(orgSlug, { partyId })).catch(() => {});
  },
  component: PartyReceipts,
});

function PartyReceipts() {
  const { orgSlug, partyId } = Route.useParams();

  const receipts = useInfiniteQuery({
    ...receiptListOptions(orgSlug, { partyId }),
    ...OPERATIONAL_INFINITE_REFETCH,
  });

  const rows = receipts.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <>
      <DataTable
        columns={RECEIPT_COLUMNS}
        data={rows}
        getRowId={(receipt) => receipt.id}
        meta={{ orgSlug }}
        // The record opens over the receipts list filtered to this party, so Back and
        // the list behind the Sheet stay on the same receipts.
        rowLink={(receipt) => ({
          to: "/$orgSlug/receipts/$receiptId",
          params: { orgSlug, receiptId: receipt.id },
          search: { partyId },
        })}
        renderCard={(receipt) => <ReceiptCard receipt={receipt} />}
        // Every row is this party's, so its name column would only repeat the header.
        columnVisibility={{ partyName: false }}
        query={receipts}
        errorTitle="Could not load receipts"
        empty={
          <TableEmpty
            title="No receipts yet"
            description="Receipts from this party appear here, newest first."
          />
        }
        growth={{
          hasMore: receipts.hasNextPage,
          pending: receipts.isFetchingNextPage,
          loadMore: () => void receipts.fetchNextPage(),
        }}
      />
      <LoadMore query={receipts} shown={rows.length} />
    </>
  );
}
