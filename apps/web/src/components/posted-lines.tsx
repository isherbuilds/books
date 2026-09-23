import { formatMoney } from "@accly/api/core/money";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";

type PostedLine = {
  id: string;
  accountName: string;
  accountCode: string;
  description: string;
  partyName?: string | null;
  side: "debit" | "credit";
  amountPaise: bigint;
};

export function PostedLines({
  lines,
  totalPaise,
}: {
  lines: readonly PostedLine[];
  totalPaise: bigint;
}) {
  const showParty = lines.some((line) => line.partyName);

  return (
    <section className="grid gap-2">
      <h3 className="min-h-6 text-muted-foreground">Lines</h3>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Description</TableHead>
              {showParty ? <TableHead>Party</TableHead> : null}
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="whitespace-normal">
                  <p>{line.accountName}</p>
                  <p className="font-mono text-muted-foreground">{line.accountCode}</p>
                </TableCell>
                <TableCell className="whitespace-normal">{line.description}</TableCell>
                {showParty ? (
                  <TableCell className="whitespace-normal">{line.partyName ?? "—"}</TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums">
                  {line.side === "debit" ? formatMoney(line.amountPaise) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.side === "credit" ? formatMoney(line.amountPaise) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={showParty ? 3 : 2}>Total</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(totalPaise)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(totalPaise)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="divide-y divide-border md:hidden">
        {lines.map((line) => (
          <div key={line.id} className="grid gap-2 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-medium">{line.accountName}</p>
                <p className="font-mono text-muted-foreground">{line.accountCode}</p>
              </div>
              <p className="shrink-0 tabular-nums">
                <span className="text-muted-foreground">{line.side === "debit" ? "Dr" : "Cr"}</span>{" "}
                {formatMoney(line.amountPaise)}
              </p>
            </div>
            {line.partyName ? (
              <p className="break-words text-muted-foreground">{line.partyName}</p>
            ) : null}
            {line.description ? (
              <p className="break-words text-muted-foreground">{line.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
