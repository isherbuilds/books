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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { ListSection, ListState, PageBody, PageHeader } from "@/components/page";
import { PaymentMethodSheet } from "@/components/payment-method-sheet";
import { invalidatePaymentMethods } from "@/lib/domain-invalidation";
import { useCan } from "@/lib/membership";
import { groupMoneyAccounts, moneyBalanceOptions } from "@/lib/money-accounts";
import { BANKS_MANAGE_PERMISSION, BANKS_PERMISSION } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { paymentMethodListOptions } from "@/lib/receipts";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/banking")({
  head: () => ({ meta: [{ title: "Banking · Accly Books" }] }),
  validateSearch: z.object({ create: z.boolean().optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, BANKS_PERMISSION);
    await Promise.all([
      queryClient.query(moneyBalanceOptions(orgSlug)).catch(() => {}),
      queryClient.query(paymentMethodListOptions(orgSlug)).catch(() => {}),
    ]);
  },
  component: BankingRoute,
});

function BankingRoute() {
  const { orgSlug } = Route.useParams();
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const canManage = useCan(orgSlug, BANKS_MANAGE_PERMISSION);

  const closeCreate = () =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, create: undefined }) });

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
              <Button
                onClick={() =>
                  void navigate({
                    to: "/$orgSlug/accounts",
                    params: { orgSlug },
                    search: { create: true },
                  })
                }
              >
                Add account
              </Button>
              <Button variant="outline" onClick={() => void navigate({ search: { create: true } })}>
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
                          {account.active ? null : <Badge variant="muted">Archived</Badge>}
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
                      {/* Restoring a method does not restore its account, and posting
                          refuses an archived account, so say which one blocks it. */}
                      <Badge
                        variant={method.active && method.accountActive ? "secondary" : "muted"}
                      >
                        {method.active
                          ? method.accountActive
                            ? "Active"
                            : "Account archived"
                          : "Archived"}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`${method.active ? "Archive" : "Restore"} ${method.name}`}
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
                          {method.active ? "Archive" : "Restore"}
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

      <PaymentMethodSheet orgSlug={orgSlug} open={create === true} onClose={closeCreate} />
    </>
  );
}
