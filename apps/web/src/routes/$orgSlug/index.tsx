import { formatMoney, isZeroMoney } from "@accly/api/core/money";
import { authorize, type AppPermission } from "@accly/auth/access";
import { buttonVariants } from "@accly/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, type LinkProps } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { ListSection, ListState, PageBody, PageHeader } from "@/components/page";
import { membershipOptions, useMembership } from "@/lib/membership";
import { groupMoneyAccounts, moneyBalanceOptions } from "@/lib/money-accounts";
import { BANKS_PERMISSION } from "@/lib/navigation";

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
    link: { to: "/$orgSlug/invoices", search: { settlement: "overdue" } },
    permission: { invoice: ["read"] },
  },
  {
    label: "Open invoices",
    hint: "Everything customers still owe",
    link: { to: "/$orgSlug/invoices", search: { settlement: "open" } },
    permission: { invoice: ["read"] },
  },
  {
    label: "Draft invoices",
    hint: "Saved, not yet posted",
    link: { to: "/$orgSlug/invoices", search: { state: "draft" } },
    permission: { invoice: ["read"] },
  },
];

const TO_PAY: readonly AttentionRow[] = [
  {
    label: "Overdue bills",
    hint: "Past due, not yet paid",
    link: { to: "/$orgSlug/bills", search: { settlement: "overdue" } },
    permission: { bill: ["read"] },
  },
  {
    label: "Open bills",
    hint: "Everything the organization still owes",
    link: { to: "/$orgSlug/bills", search: { settlement: "open" } },
    permission: { bill: ["read"] },
  },
  {
    label: "Draft bills",
    hint: "Saved, not yet posted",
    link: { to: "/$orgSlug/bills", search: { state: "draft" } },
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

    // Streams: the links render at once and the balances follow.
    if (authorize(membership.roles, BANKS_PERMISSION)) {
      void queryClient.query(moneyBalanceOptions(orgSlug)).catch(() => {});
    }
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
  const rows = groups.data ?? [];

  return (
    <ListSection
      label="Cash and bank"
      action={
        <Link to="/$orgSlug/banking" params={{ orgSlug }} className="hover:text-foreground">
          Banking
        </Link>
      }
    >
      {/* Balances stream in after the page; hold one row so the box never collapses. */}
      <div className="min-h-9">
        <ListState
          query={groups}
          errorTitle="Could not load balances"
          isEmpty={rows.length === 0}
          empty="No money accounts yet"
        >
          <ul className="divide-y">
            {rows.flatMap((group) =>
              group.leaves
                // An archived account still shows while money sits in it.
                .filter((account) => account.active || !isZeroMoney(account.balancePaise))
                .map((account) => (
                  <li key={account.id} className="flex h-9 items-center gap-3 px-3">
                    <span className="min-w-0 flex-1 truncate">{account.name}</span>
                    <span className="text-muted-foreground">{group.name}</span>
                    <span className="w-32 text-right text-xs font-medium tabular-nums">
                      {formatMoney(account.balancePaise)}
                    </span>
                  </li>
                )),
            )}
          </ul>
        </ListState>
      </div>
    </ListSection>
  );
}
