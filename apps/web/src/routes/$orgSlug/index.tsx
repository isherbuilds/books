import {
  creditOf,
  debitOf,
  formatMoney,
  formatRupees,
  isPositiveMoney,
  isZeroMoney,
  sumPaise,
} from "@accly/api/core/money";
import { authorize, type AppPermission } from "@accly/auth/access";
import { buttonVariants } from "@accly/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type LinkProps } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ListSection, ListState, PageBody, PageHeader } from "@/components/page";
import { membershipOptions, useCan, useMembership } from "@/lib/membership";
import { groupMoneyAccounts, moneyBalanceOptions } from "@/lib/money-accounts";
import { BANKS_PERMISSION } from "@/lib/navigation";
import { partyBalancesOptions } from "@/lib/parties";

// Each row opens a filtered register instead of counting here: the registers already
// answer "which ones", and a count per row would cost a query per row on every visit.
type AttentionRow = {
  label: string;
  hint: string;
  link: Pick<LinkProps, "to" | "search">;
  permission: AppPermission;
};

const TO_COLLECT: readonly AttentionRow[] = [
  {
    label: "Overdue invoices",
    hint: "Past due, not yet received",
    link: { to: "/$orgSlug/invoices", search: { status: "overdue", all: true } },
    permission: { invoice: ["read"] },
  },
  {
    label: "Open invoices",
    hint: "Everything customers still owe",
    link: { to: "/$orgSlug/invoices", search: { status: "open", all: true } },
    permission: { invoice: ["read"] },
  },
  {
    label: "Draft invoices",
    hint: "Saved, not yet posted",
    link: { to: "/$orgSlug/invoices", search: { status: "draft", all: true } },
    permission: { invoice: ["read"] },
  },
];

const TO_PAY: readonly AttentionRow[] = [
  {
    label: "Overdue bills",
    hint: "Past due, not yet paid",
    link: { to: "/$orgSlug/bills", search: { status: "overdue", all: true } },
    permission: { bill: ["read"] },
  },
  {
    label: "Open bills",
    hint: "Everything the organization still owes",
    link: { to: "/$orgSlug/bills", search: { status: "open", all: true } },
    permission: { bill: ["read"] },
  },
  {
    label: "Draft bills",
    hint: "Saved, not yet posted",
    link: { to: "/$orgSlug/bills", search: { status: "draft", all: true } },
    permission: { bill: ["read"] },
  },
];

const CREATE: readonly {
  label: string;
  link: Pick<LinkProps, "to" | "search">;
  permission: AppPermission;
}[] = [
  {
    label: "New invoice",
    link: { to: "/$orgSlug/invoices/new" },
    permission: { invoice: ["create"] },
  },
  {
    label: "New receipt",
    link: { to: "/$orgSlug/receipts", search: { create: true } },
    permission: { receipt: ["post"] },
  },
  { label: "New bill", link: { to: "/$orgSlug/bills/new" }, permission: { bill: ["create"] } },
  {
    label: "New payment",
    link: { to: "/$orgSlug/payments", search: { create: true } },
    permission: { payment: ["post"] },
  },
  {
    label: "New journal",
    link: { to: "/$orgSlug/journals/new" },
    permission: { journal: ["post"] },
  },
];

export const Route = createFileRoute("/$orgSlug/")({
  head: () => ({ meta: [{ title: "Home · Accly Books" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const membership = await queryClient.query(membershipOptions(orgSlug));

    // Awaited, so the server renders the figures the client hydrates: a streamed
    // prefetch read by `useQuery` lands before hydration and mismatches. Catch
    // failed prefetches so each section can show its own read error.
    await Promise.all([
      authorize(membership.roles, BANKS_PERMISSION) &&
        queryClient.query(moneyBalanceOptions(orgSlug)).catch(() => {}),
      authorize(membership.roles, POSITION_PERMISSION) &&
        queryClient.query(partyBalancesOptions(orgSlug)).catch(() => {}),
    ]);
  },
  component: HomeRoute,
});

function HomeRoute() {
  const { orgSlug } = Route.useParams();
  const roles = useMembership(orgSlug, (membership) => membership.roles);

  const allowed = <Row extends { permission: AppPermission }>(rows: readonly Row[]) =>
    rows.filter((row) => authorize(roles, row.permission));

  const collect = allowed(TO_COLLECT);
  const pay = allowed(TO_PAY);
  const create = allowed(CREATE);

  return (
    <>
      <PageHeader title="Home" description="What needs attention" />
      <PageBody>
        {create.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {create.map(({ label, link }) => (
              <Link
                key={label}
                {...link}
                params={{ orgSlug }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {label}
              </Link>
            ))}
          </div>
        )}

        <Position orgSlug={orgSlug} />

        <div className="grid gap-4 md:grid-cols-2">
          {collect.length > 0 && (
            <AttentionList label="To collect" rows={collect} orgSlug={orgSlug} />
          )}
          {pay.length > 0 && <AttentionList label="To pay" rows={pay} orgSlug={orgSlug} />}
        </div>

        {authorize(roles, BANKS_PERMISSION) && <CashAndBank orgSlug={orgSlug} />}
      </PageBody>
    </>
  );
}

// `party.balances` needs both grants; the cards hide without them.
const POSITION_PERMISSION: AppPermission = { party: ["read"], report: ["read"] };

/**
 * The owner's three figures (design system Owner Home): who owes you, whom you owe
 * and the money in hand, in whole rupees. A party's closing balance is Dr when it
 * owes you and Cr when you owe it, so the two sides sum separately.
 */
function Position({ orgSlug }: { orgSlug: string }) {
  const showParties = useCan(orgSlug, POSITION_PERMISSION);
  const showCash = useCan(orgSlug, BANKS_PERMISSION);

  const parties = useQuery({
    ...partyBalancesOptions(orgSlug),
    enabled: showParties,
    select: (rows) => ({
      owed: sumPaise(rows.map((row) => debitOf(row.balancePaise))),
      owe: sumPaise(rows.map((row) => creditOf(row.balancePaise))),
      owedBy: rows.filter((row) => isPositiveMoney(debitOf(row.balancePaise))).length,
      owedTo: rows.filter((row) => isPositiveMoney(creditOf(row.balancePaise))).length,
    }),
  });

  const cash = useQuery({
    ...moneyBalanceOptions(orgSlug),
    enabled: showCash,
    select: (accounts) => sumPaise(accounts.map((account) => account.balancePaise)),
  });

  if (!showParties && !showCash) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {showParties ? (
        <>
          <StatCard
            label="You're owed"
            value={parties.data && formatRupees(parties.data.owed)}
            foot={parties.data && `${parties.data.owedBy} parties`}
          />
          <StatCard
            label="You owe"
            value={parties.data && formatRupees(parties.data.owe)}
            foot={parties.data && `${parties.data.owedTo} parties`}
          />
        </>
      ) : null}
      {showCash ? (
        <StatCard
          label="Cash and bank"
          value={cash.data === undefined ? undefined : formatRupees(cash.data)}
          foot={
            <Link to="/$orgSlug/banking" params={{ orgSlug }} className="hover:text-foreground">
              Banking
            </Link>
          }
        />
      ) : null}
    </div>
  );
}

function StatCard({ label, value, foot }: { label: string; value?: string; foot?: ReactNode }) {
  return (
    <section aria-label={label} className="grid gap-1 rounded-lg border border-border bg-card p-4">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </h2>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{value ?? "—"}</p>
      <p className="min-h-5 text-muted-foreground">{foot}</p>
    </section>
  );
}

function AttentionList({
  label,
  rows,
  orgSlug,
}: {
  label: string;
  rows: readonly AttentionRow[];
  orgSlug: string;
}) {
  return (
    <ListSection label={label}>
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.label}>
            <Link
              {...row.link}
              params={{ orgSlug }}
              data-focus-inset
              className="flex h-10 items-center gap-3 px-3 hover:bg-muted/50"
            >
              <span className="font-medium">{row.label}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.hint}</span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </ListSection>
  );
}

function CashAndBank({ orgSlug }: { orgSlug: string }) {
  const groups = useQuery({ ...moneyBalanceOptions(orgSlug), select: groupMoneyAccounts });

  // An archived account still shows while money sits in it.
  const rows = (groups.data ?? []).flatMap((group) =>
    group.leaves
      .filter((account) => account.active || !isZeroMoney(account.balancePaise))
      .map((account) => ({ ...account, groupName: group.name })),
  );

  return (
    <ListSection
      label="Cash and bank"
      action={
        <Link to="/$orgSlug/banking" params={{ orgSlug }} className="hover:text-foreground">
          Banking
        </Link>
      }
    >
      {/* Hold one row while balances refresh so the box does not collapse. */}
      <div className="min-h-9">
        <ListState
          query={groups}
          errorTitle="Could not load balances"
          isEmpty={rows.length === 0}
          empty="No money accounts yet"
        >
          <ul className="divide-y">
            {rows.map((account) => (
              <li key={account.id} className="flex h-9 items-center gap-3 px-3">
                <span className="min-w-0 flex-1 truncate">{account.name}</span>
                <span className="text-muted-foreground">{account.groupName}</span>
                <span className="w-32 text-right text-sm font-medium tabular-nums">
                  {formatMoney(account.balancePaise)}
                </span>
              </li>
            ))}
          </ul>
        </ListState>
      </div>
    </ListSection>
  );
}
