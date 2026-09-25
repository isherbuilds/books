import { formatMoney } from "@accly/api/core/money";
import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { AccountSheet } from "@/components/account-sheet";
import { ListSection, ListState, PageBody, PageHeader } from "@/components/page";
import { PaymentMethodSheet } from "@/components/payment-method-sheet";
import { accountListOptions, deriveAccountRows } from "@/lib/accounts";
import { invalidatePaymentMethods } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { groupMoneyAccounts, moneyBalanceOptions } from "@/lib/money-accounts";
import { BANKS_MANAGE_PERMISSION, BANKS_PERMISSION } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";
import { errorMessage, loadRouteQuery } from "@/lib/orpc-error";
import { paymentMethodListOptions } from "@/lib/receipts";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/banking")({
  head: () => ({ meta: [{ title: "Banking · Accly Books" }] }),
  // `create` opens the account or the method Sheet; `accountId` preselects the account
  // a new method lands in, so adding an account continues straight to its method.
  validateSearch: z.object({
    create: z.enum(["account", "method"]).optional().catch(undefined),
    accountId: z.uuid().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, BANKS_PERMISSION);
    await Promise.all([
      queryClient.query(moneyBalanceOptions(orgSlug)).catch(() => {}),
      queryClient.query(paymentMethodListOptions(orgSlug)).catch(() => {}),
      // The account Sheet's parent list; a failed load reaches the route error view.
      loadRouteQuery(queryClient.query(accountListOptions(orgSlug))),
    ]);
  },
  component: BankingRoute,
});

function BankingRoute() {
  const { orgSlug } = Route.useParams();
  const { create, accountId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const canManage = useCan(orgSlug, BANKS_MANAGE_PERMISSION);

  const closeCreate = () =>
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, create: undefined, accountId: undefined }),
    });

  const chart = useSuspenseQuery({
    ...accountListOptions(orgSlug),
    select: deriveAccountRows,
  }).data;

  // A Payment Method takes only a leaf directly under the cash or bank group, so a new
  // money account goes there: Bank Accounts first, Cash one choice away.
  const moneyGroups = chart.filter(
    (account) => account.systemKey === "bank" || account.systemKey === "cash",
  );

  const bankGroupId = moneyGroups.find((account) => account.systemKey === "bank")?.id ?? "";

  const groups = useQuery({
    ...moneyBalanceOptions(orgSlug),
    select: groupMoneyAccounts,
  });

  const methods = useQuery(paymentMethodListOptions(orgSlug));

  const setActive = useMutation(
    orpc.paymentMethod.setActive.mutationOptions({
      onSuccess: () => invalidatePaymentMethods(queryClient, orgSlug),
      onError: (error) => toast.error(errorMessage(error, "Could not update the payment method")),
    }),
  );

  const groupRows = groups.data ?? [];
  const methodRows = methods.data ?? [];

  return (
    <>
      <PageHeader
        title="Banking"
        description="Cash boxes, bank accounts, and the payment methods that land in them"
        action={
          canManage ? (
            <>
              <Button onClick={() => void navigate({ search: { create: "account" } })}>
                Add account
              </Button>
              <Button
                variant="outline"
                onClick={() => void navigate({ search: { create: "method" } })}
              >
                Add method
              </Button>
            </>
          ) : null
        }
      />
      <PageBody>
        <ListSection label="Accounts">
          <ListState
            query={groups}
            errorTitle="Could not load accounts"
            isEmpty={groupRows.length === 0}
            empty="No money accounts yet"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              {groupRows.map((group) => (
                <TableBody key={group.id}>
                  <TableRow>
                    <TableCell colSpan={3}>
                      <span className="font-medium">{group.name}</span>
                    </TableCell>
                  </TableRow>
                  {group.leaves.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-mono">{account.code}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1">
                          {account.name}
                          {account.active ? null : <Badge variant="muted">Inactive</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium tabular-nums">
                        {formatMoney(account.balancePaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              ))}
            </Table>
          </ListState>
        </ListSection>

        <ListSection label="Payment methods">
          <ListState
            query={methods}
            errorTitle="Could not load payment methods"
            isEmpty={methodRows.length === 0}
            empty="No payment methods yet"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Lands in</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? (
                    <TableHead className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {methodRows.map((method) => (
                  <TableRow key={method.id}>
                    <TableCell className="font-medium">{method.name}</TableCell>
                    <TableCell>{method.accountName}</TableCell>
                    <TableCell>
                      {/* Reactivating a method does not reactivate its account, and posting
                          refuses an inactive account, so say which one blocks it. */}
                      <Badge
                        variant={method.active && method.accountActive ? "secondary" : "muted"}
                      >
                        {method.active
                          ? method.accountActive
                            ? "Active"
                            : "Account inactive"
                          : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`Mark ${method.name} ${method.active ? "inactive" : "active"}`}
                          disabled={
                            setActive.isPending && setActive.variables.paymentMethodId === method.id
                          }
                          onClick={() =>
                            setActive.mutate({
                              orgSlug,
                              paymentMethodId: method.id,
                              active: !method.active,
                            })
                          }
                        >
                          {method.active ? "Mark inactive" : "Mark active"}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListState>
        </ListSection>
      </PageBody>

      {canManage && create === "account" ? (
        <AccountSheet
          orgSlug={orgSlug}
          accounts={chart}
          defaultParent={bankGroupId}
          parentIds={moneyGroups.map((account) => account.id)}
          onCreated={(account) =>
            void navigate({ replace: true, search: { create: "method", accountId: account.id } })
          }
          onClose={closeCreate}
        />
      ) : null}
      <PaymentMethodSheet
        // Remounted per account, so the form opens with the new account chosen.
        key={accountId ?? "method"}
        orgSlug={orgSlug}
        open={create === "method"}
        accountId={accountId}
        onClose={closeCreate}
      />
    </>
  );
}
