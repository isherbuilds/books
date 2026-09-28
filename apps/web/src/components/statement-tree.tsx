import { formatMoney } from "@accly/api/core/money";
import type { StatementNode } from "@accly/api/core/reports";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";

import type { DateRange } from "@/lib/date-presets";

type Props = {
  title: string;
  nodes: StatementNode[];
  totalPaise: bigint;
  orgSlug: string;
  period: DateRange;
  computedRows?: { label: string; amountPaise: bigint }[];
};

function StatementRow({
  node,
  depth,
  orgSlug,
  period,
}: {
  node: StatementNode;
  depth: number;
  orgSlug: string;
  period: DateRange;
}) {
  const [expanded, setExpanded] = useState(true);
  const group = node.children.length > 0;

  return (
    <>
      <div
        className={`flex min-w-0 items-center justify-between gap-2 border-t border-border px-3 py-2 md:min-w-max md:gap-4 ${group ? "bg-muted/50 font-medium" : ""}`}
      >
        <div
          className="flex min-w-0 items-center gap-2 pl-(--mobile-indent) md:pl-(--desktop-indent)"
          // SAFETY: React forwards custom properties unchanged; CSSProperties lacks `--*` keys.
          style={
            {
              "--mobile-indent": `${Math.min(depth, 2) * 8}px`,
              "--desktop-indent": `${depth * 16}px`,
            } as CSSProperties
          }
        >
          {group ? (
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center pointer-coarse:size-11"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <ChevronDownIcon className="size-4" />
              ) : (
                <ChevronRightIcon className="size-4" />
              )}
            </button>
          ) : (
            <span className="w-8 shrink-0" aria-hidden="true" />
          )}
          <span className="hidden font-mono text-muted-foreground md:inline">{node.code}</span>
          {group ? (
            <span className="min-w-0 break-words capitalize">{node.name}</span>
          ) : (
            <Link
              to="/$orgSlug/reports/account-ledger"
              params={{ orgSlug }}
              search={{ accountId: node.accountId, ...period }}
              className="min-w-0 break-words capitalize underline-offset-4 hover:underline"
            >
              {node.name}
            </Link>
          )}
        </div>
        <span className="w-money shrink-0 text-right whitespace-nowrap tabular-nums">
          {formatMoney(node.amountPaise)}
        </span>
      </div>
      {group && expanded
        ? node.children.map((child) => (
            <StatementRow
              key={child.accountId}
              node={child}
              depth={depth + 1}
              orgSlug={orgSlug}
              period={period}
            />
          ))
        : null}
    </>
  );
}

export function StatementTree({ title, nodes, totalPaise, orgSlug, period, computedRows }: Props) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-border bg-card md:overflow-x-auto"
    >
      <div className="min-w-0 md:min-w-max">
        <div className="flex min-w-0 items-center justify-between gap-2 bg-muted px-3 py-2 font-medium md:min-w-max md:gap-4">
          <h2 className="min-w-0 break-words">{title}</h2>
          <span className="w-money shrink-0 text-right text-xs text-muted-foreground">Amount</span>
        </div>
        {nodes.map((node) => (
          <StatementRow
            key={node.accountId}
            node={node}
            depth={0}
            orgSlug={orgSlug}
            period={period}
          />
        ))}
        {computedRows?.map((row) => (
          <div
            key={row.label}
            className="flex min-w-0 items-center justify-between gap-2 border-t border-border px-3 py-2 md:min-w-max md:gap-4"
          >
            <span className="min-w-0 break-words pl-4 md:pl-10">{row.label}</span>
            <span className="w-money shrink-0 text-right whitespace-nowrap tabular-nums">
              {formatMoney(row.amountPaise)}
            </span>
          </div>
        ))}
        <div className="flex min-w-0 items-center justify-between gap-2 border-t-2 border-foreground px-3 py-2 font-medium md:min-w-max md:gap-4">
          <span className="min-w-0 break-words">Total {title.toLowerCase()}</span>
          <span className="w-money shrink-0 text-right whitespace-nowrap tabular-nums">
            {formatMoney(totalPaise)}
          </span>
        </div>
      </div>
    </section>
  );
}
