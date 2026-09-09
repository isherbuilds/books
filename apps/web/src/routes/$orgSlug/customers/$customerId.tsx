import { toSignedPaise } from "@accly/api/lib/invoice-math";
import { authorize, type AppPermission } from "@accly/auth/access";
import { Button, buttonVariants } from "@accly/ui/components/button";
import { cn } from "@accly/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarIcon, PencilIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { z } from "zod";

import { Monogram } from "@/components/monogram";
import { PageBody, PageHeader, PageTab, PageTabs } from "@/components/page";
import type { EditableCustomer } from "@/components/customer-form";
import { CustomerBilling, type CustomerAccount } from "@/components/customer-record/billing";
import { CustomerVisits } from "@/components/customer-record/visits";
import { CustomerSheet } from "@/components/customer-sheet";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { PAYER_TYPE_LABELS } from "@/lib/payer";
import { loadRouteQuery } from "@/lib/orpc-error";
import { customerAgeLabel } from "@/lib/customer-age";

const TABS = [
  { id: "record", label: "Record", permission: { customer: ["read"] } },
  { id: "visits", label: "Visits", permission: { opd: ["read"] } },
  { id: "billing", label: "Billing", permission: { billing: ["read"] } },
] as const satisfies readonly { id: string; label: string; permission: AppPermission }[];

type TabId = (typeof TABS)[number]["id"];

export const Route = createFileRoute("/$orgSlug/customers/$customerId")({
  // Every open editor and expanded visit belongs to the record above it, so customer A
  // must not hand its state to customer B.
  remountDeps: ({ params }) => ({ customerId: params.customerId }),
  loader: async ({ context: { queryClient }, params: { orgSlug, customerId } }) => {
    // The page is the record: without it there is nothing to show, so a failure belongs
    // to the route, not to a note inside a page that has no content.
    await loadRouteQuery(
      queryClient.query(orpc.customer.get.queryOptions({ input: { orgSlug, customerId } })),
    );
  },
  // The open tab lives in the URL so a link is shareable and Back from a visit lands
  // where the user left.
  validateSearch: z.object({
    tab: z.enum(["record", "visits", "billing"]).optional().catch(undefined),
  }),
  component: CustomerDetailRoute,
});

function PinnedFacts({
  record,
  ageLabel,
  canReadBilling,
  account,
  currency,
}: {
  record: EditableCustomer;
  ageLabel: string;
  canReadBilling: boolean;
  account: CustomerAccount | undefined;
  currency: string;
}) {
  const outstanding = account?.outstanding;
  const owes = outstanding !== undefined && toSignedPaise(outstanding) !== 0;

  return (
    <div className="shrink-0 border-b border-border bg-card px-3 py-3 lg:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Monogram label={record.name} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-sm font-medium">{record.name}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{record.code}</span>
            {" · "}
            <span className="capitalize">{record.sex}</span>
            {` · ${ageLabel} years`}
          </p>
          {/* Who is covering this customer, nothing more: the policy and employee
              numbers belong beside the Edit button that changes them. */}
          {record.sponsor ? (
            <p className="truncate text-xs text-muted-foreground">
              Sponsor: {record.sponsor.payerName}
            </p>
          ) : null}
        </div>

        {canReadBilling && outstanding !== undefined ? (
          <p className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Outstanding</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                owes ? "text-status-alert" : "text-muted-foreground",
              )}
            >
              {formatMoney(outstanding, currency)}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-1 border-b border-border/60 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function RecordTab({
  orgSlug,
  record,
  ageLabel,
}: {
  orgSlug: string;
  record: EditableCustomer;
  ageLabel: string;
}) {
  const { roles } = useMembership(orgSlug);
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Details</p>
          {authorize(roles, { customer: ["update"] }) ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon />
              Edit
            </Button>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8">
          <Row label="Code">
            <span className="font-mono text-muted-foreground">{record.code}</span>
          </Row>
          <Row label="Name">{record.name}</Row>
          <Row label="Phone">
            <span className="font-mono tabular-nums">{record.phone}</span>
          </Row>
          <Row label="Sex">
            <span className="capitalize">{record.sex}</span>
          </Row>
          <Row label="Date of birth">
            {formatBusinessDate(record.dateOfBirth)}
            {record.dobEstimated ? <Empty> · estimated from age</Empty> : null}
          </Row>
          <Row label="Age">{ageLabel} years</Row>
          <Row label="Email">{record.email ?? <Empty>Not recorded</Empty>}</Row>
          <Row label="Tax ID / GSTIN">
            {record.uid ? (
              <span className="font-mono">{record.uid}</span>
            ) : (
              <Empty>Not recorded</Empty>
            )}
          </Row>
          <Row label="Address">{record.address || <Empty>Not recorded</Empty>}</Row>
          <Row label="Sponsor">
            {record.sponsor ? (
              <>
                {record.sponsor.payerName} ({PAYER_TYPE_LABELS[record.sponsor.payerType]})
              </>
            ) : (
              <Empty>Self-paying</Empty>
            )}
          </Row>
          {record.sponsor?.policyNumber ? (
            <Row label="Policy number">
              <span className="font-mono">{record.sponsor.policyNumber}</span>
            </Row>
          ) : null}
          {record.sponsor?.employeeNumber ? (
            <Row label="Employee number">
              <span className="font-mono">{record.sponsor.employeeNumber}</span>
            </Row>
          ) : null}
        </dl>
      </section>

      <CustomerSheet orgSlug={orgSlug} customer={record} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

function CustomerRecordSections({
  orgSlug,
  customerId,
  record,
  ageLabel,
  currency,
  visible,
  account,
  accountPending,
  accountError,
}: {
  orgSlug: string;
  customerId: string;
  record: EditableCustomer;
  ageLabel: string;
  currency: string;
  visible: (typeof TABS)[number][];
  account: CustomerAccount | undefined;
  accountPending: boolean;
  accountError: Error | null;
}) {
  const { tab } = Route.useSearch();
  const active: TabId = visible.some((entry) => entry.id === tab) ? (tab as TabId) : "record";

  return (
    <>
      <PageTabs label="Customer record sections" className="mx-auto w-full max-w-4xl">
        {visible.map(({ id, label }) => (
          <PageTab
            key={id}
            to="/$orgSlug/customers/$customerId"
            params={{ orgSlug, customerId }}
            search={id === "record" ? {} : { tab: id }}
            data-status={active === id ? "active" : undefined}
          >
            {label}
          </PageTab>
        ))}
      </PageTabs>

      <PageBody>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          {active === "record" ? (
            <RecordTab orgSlug={orgSlug} record={record} ageLabel={ageLabel} />
          ) : active === "visits" ? (
            <CustomerVisits orgSlug={orgSlug} customerId={customerId} currency={currency} />
          ) : (
            <CustomerBilling
              orgSlug={orgSlug}
              account={account}
              isPending={accountPending}
              error={accountError}
            />
          )}
        </div>
      </PageBody>
    </>
  );
}

function CustomerDetailRoute() {
  const { orgSlug, customerId } = Route.useParams();
  const { today } = useOrgDateTime();
  // The loader awaited this and turns a missing customer into a 404, so it is present
  // here — a `useQuery` beside it would only add branches that never run.
  const record = useSuspenseQuery(
    orpc.customer.get.queryOptions({ input: { orgSlug, customerId } }),
  ).data;
  const { roles, currency } = useMembership(orgSlug);
  const canReadCustomer = authorize(roles, { customer: ["read"] });
  const canReadVisits = authorize(roles, { opd: ["read"] });
  const canReadBilling = authorize(roles, { billing: ["read"] });
  const visible = TABS.filter(({ id }) =>
    id === "record" ? canReadCustomer : id === "visits" ? canReadVisits : canReadBilling,
  );
  const account = useQuery({
    ...orpc.customer.account.queryOptions({ input: { orgSlug, customerId } }),
    enabled: canReadBilling,
  });
  const ageLabel = customerAgeLabel(record.dateOfBirth, record.dobEstimated, today);

  return (
    <>
      <PageHeader
        title="Customer"
        description={`${record.code} · ${record.name}`}
        action={
          authorize(roles, { opd: ["create"] }) ? (
            <Link
              className={buttonVariants()}
              to="/$orgSlug/opd/new"
              params={{ orgSlug }}
              search={{ customerId }}
            >
              <CalendarIcon />
              Book appointment
            </Link>
          ) : undefined
        }
      />

      <PinnedFacts
        account={account.data}
        record={record}
        ageLabel={ageLabel}
        canReadBilling={canReadBilling}
        currency={currency}
      />

      <CustomerRecordSections
        orgSlug={orgSlug}
        customerId={customerId}
        record={record}
        ageLabel={ageLabel}
        currency={currency}
        visible={visible}
        account={account.data}
        accountPending={account.isPending}
        accountError={account.error}
      />
    </>
  );
}
