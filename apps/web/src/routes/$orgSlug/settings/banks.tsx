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

import { MoneyAccountSheet } from "@/components/money-account-sheet";
import { ListState, PageBody, PageHeader, Panel } from "@/components/page";
import { PaymentMethodSheet } from "@/components/payment-method-sheet";
import { useCan } from "@/lib/membership";
import { groupMoneyAccounts } from "@/lib/money-accounts";
import { BANKS_MANAGE_PERMISSION, BANKS_PERMISSION } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { paymentMethodListOptions } from "@/lib/receipts";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

export const Route = createFileRoute("/$orgSlug/settings/banks")({
  head: () => ({ meta: [{ title: "Banks · Accly Books" }] }),
  validateSearch: z.object({ create: z.enum(["account", "method"]).optional().catch(undefined) }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, BANKS_PERMISSION);
    await Promise.all([
      queryClient
        .query(orpc.account.moneyBalances.queryOptions({ input: { orgSlug } }))
        .catch(() => {}),
      queryClient.query(paymentMethodListOptions(orgSlug)).catch(() => {}),
    ]);
  },
  component: BanksRoute,
});

function BanksRoute() {
  const { orgSlug } = Route.useParams();
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  // Readers such as the CA see balances and methods; only managers add or archive.
  const canManage = useCan(orgSlug, BANKS_MANAGE_PERMISSION);

  const closeCreate = () =>
    void navigate({ replace: true, search: (previous) => ({ ...previous, create: undefined }) });

  const groups = useQuery({
    ...orpc.account.moneyBalances.queryOptions({ input: { orgSlug } }),
    select: groupMoneyAccounts,
  });

  const methods = useQuery(paymentMethodListOptions(orgSlug));

  const setActive = useMutation(
    orpc.paymentMethod.setActive.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: orpc.paymentMethod.list.key({ input: { orgSlug } }),
        }),
      onError: (error) => toast.error(errorMessage(error, "Could not update the payment method")),
    }),
  );

  const groupRows = groups.data ?? [];
  const methodRows = methods.data ?? [];

  return (
    <>
      <PageHeader
        title="Banks"
        description="Cash boxes, bank accounts, and the payment methods that land in them"
      />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody>
        <Panel
          label="Accounts"
          action={
            canManage ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void navigate({ search: { create: "account" } })}
              >
                Add account
              </Button>
            ) : null
          }
        >
          <ListState
            query={groups}
            errorTitle="Could not load accounts"
            isEmpty={groupRows.length === 0}
            empty="No money accounts yet."
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
                        {account.name}
                        {account.active ? null : (
                          <span className="text-muted-foreground"> (inactive)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(account.balancePaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              ))}
            </Table>
          </ListState>
        </Panel>

        <Panel
          label="Payment methods"
          action={
            canManage ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void navigate({ search: { create: "method" } })}
              >
                Add method
              </Button>
            ) : null
          }
        >
          <ListState
            query={methods}
            errorTitle="Could not load payment methods"
            isEmpty={methodRows.length === 0}
            empty="No payment methods yet."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Lands in</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {methodRows.map((method) => (
                  <TableRow key={method.id}>
                    <TableCell className="font-medium">{method.name}</TableCell>
                    <TableCell>{method.accountName}</TableCell>
                    <TableCell>
                      <Badge variant={method.active ? "secondary" : "muted"}>
                        {method.active ? "Active" : "Archived"}
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
        </Panel>
      </PageBody>

      <MoneyAccountSheet orgSlug={orgSlug} open={create === "account"} onClose={closeCreate} />
      <PaymentMethodSheet orgSlug={orgSlug} open={create === "method"} onClose={closeCreate} />
    </>
  );
}
