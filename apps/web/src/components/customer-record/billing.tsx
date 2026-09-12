import { formatDecimal, parseMoney } from "@accly/api/core/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { cn } from "@accly/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { ErrorNote, Panel, PanelEmpty } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";

export type CustomerAccount = {
  invoices: {
    id: string;
    invoiceNumber: string;
    grandTotal: string;
    currency: string;
    createdAt: string | Date;
    paymentsTotal: string;
    outstanding: string;
  }[];
  openCount: number;
  outstanding: string;
};

export function CustomerBilling({
  orgSlug,
  account,
  isPending,
  error,
}: {
  orgSlug: string;
  account: CustomerAccount | undefined;
  isPending: boolean;
  error: Error | null;
}) {
  const { timeZone } = useOrgDateTime();

  const invoices = account?.invoices ?? [];
  const [firstInvoice] = invoices;
  const outstandingPaise = account ? parseMoney(account.outstanding) : 0n;

  return (
    <div className="flex flex-col gap-4">
      {account && firstInvoice ? (
        <section className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-muted-foreground">
            {outstandingPaise < 0n ? "Refund due" : "Outstanding"}
          </p>
          <p
            className={cn(
              "text-sm font-medium tabular-nums",
              outstandingPaise < 0n
                ? "text-destructive"
                : account.openCount > 0
                  ? "text-status-alert"
                  : undefined,
            )}
          >
            {formatMoney(
              formatDecimal(outstandingPaise < 0n ? -outstandingPaise : outstandingPaise),
              firstInvoice.currency,
            )}
          </p>
          <p className="text-muted-foreground">
            {account.openCount === 0
              ? "every invoice is settled"
              : `across ${account.openCount} open ${account.openCount === 1 ? "invoice" : "invoices"}`}
          </p>
        </section>
      ) : null}

      <Panel label="Invoices">
        {error ? <ErrorNote title="Could not load billing" error={error} inset /> : null}
        {!error && !isPending && account && !firstInvoice ? (
          <PanelEmpty>No invoice has been raised for this customer.</PanelEmpty>
        ) : null}
        {firstInvoice ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const due = parseMoney(invoice.outstanding) !== 0n;

                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono whitespace-nowrap">
                      <Link
                        to="/$orgSlug/billing/invoices/$invoiceId"
                        params={{ orgSlug, invoiceId: invoice.id }}
                        className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(invoice.createdAt, timeZone)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(invoice.grandTotal, invoice.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(invoice.paymentsTotal, invoice.currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        due ? "text-status-alert" : "text-muted-foreground",
                      )}
                    >
                      {formatMoney(invoice.outstanding, invoice.currency)}
                    </TableCell>
                    <TableCell>
                      <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </Panel>
    </div>
  );
}
