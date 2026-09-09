import { Button } from "@accly/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { z } from "zod";

import {
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { CustomerSheet } from "@/components/customer-sheet";
import { useCan } from "@/lib/membership";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { customerAgeLabel } from "@/lib/customer-age";

const customerSearchQuery = (orgSlug: string, query: string) =>
  orpc.customer.search.infiniteOptions({
    input: (cursor: string | undefined) => ({
      orgSlug,
      query: query || undefined,
      cursor,
      limit: 20,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

function CustomerResults({ orgSlug, query }: { orgSlug: string; query: string }) {
  const { timeZone, today } = useOrgDateTime();
  const customers = useInfiniteQuery(customerSearchQuery(orgSlug, query));
  const items = customers.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Panel label="Registry" footer={<LoadMore query={customers} shown={items.length} />}>
      <ListState
        query={customers}
        errorTitle="Could not load customers"
        isEmpty={items.length === 0}
        empty={query ? "No customers match this search." : "No customers registered yet."}
      >
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Sex</TableHead>
                  <TableHead className="w-16 text-right">Age</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-mono">{customer.code}</TableCell>
                    <TableCell>
                      <Link
                        to="/$orgSlug/customers/$customerId"
                        params={{ orgSlug, customerId: customer.id }}
                        className="font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                      >
                        {customer.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">{customer.phone}</TableCell>
                    <TableCell className="capitalize">{customer.sex}</TableCell>
                    <TableCell className="text-right">
                      {customerAgeLabel(customer.dateOfBirth, customer.dobEstimated, today)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(customer.createdAt, timeZone)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="md:hidden">
            {items.map((customer) => (
              <li key={customer.id}>
                <Link
                  to="/$orgSlug/customers/$customerId"
                  params={{ orgSlug, customerId: customer.id }}
                  className="block min-h-10 border-b px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 font-mono">{customer.code}</span>
                    <span className="min-w-0 truncate font-medium">{customer.name}</span>
                  </div>
                  <p className="mt-1 truncate font-mono tabular-nums">{customer.phone}</p>
                  <p className="mt-1 truncate text-muted-foreground">
                    <span className="capitalize">{customer.sex}</span>
                    {" · "}
                    {customerAgeLabel(customer.dateOfBirth, customer.dobEstimated, today)}
                    {" · "}
                    {formatDate(customer.createdAt, timeZone)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      </ListState>
    </Panel>
  );
}

function CustomerRegistry({ orgSlug }: { orgSlug: string }) {
  const [query, setQuery] = useState("");

  return (
    <PageBody>
      <ListToolbar>
        <SearchInput
          label="Search customers"
          placeholder="Search name, code, or phone"
          onQueryChange={setQuery}
        />
      </ListToolbar>
      <CustomerResults orgSlug={orgSlug} query={query} />
    </PageBody>
  );
}

export const Route = createFileRoute("/$orgSlug/customers/")({
  head: () => ({ meta: [{ title: "Customers · Accly Books" }] }),
  // Registration is a panel over this list, so its open state lives in the URL: the
  // link is shareable and Back closes it.
  validateSearch: z.object({
    create: z.boolean().optional().catch(undefined),
  }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await queryClient.infiniteQuery(customerSearchQuery(orgSlug, "")).catch(() => {});
  },
  component: CustomersRoute,
});

function CustomersRoute() {
  const { orgSlug } = Route.useParams();
  const { create } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const registerTrigger = useRef<HTMLButtonElement>(null);
  // Cashiers and accountants read the registry but cannot register.
  const canRegister = useCan(orgSlug, { customer: ["create"] });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Every customer registered in this organization"
        action={
          canRegister ? (
            <Button
              ref={registerTrigger}
              onClick={() => navigate({ search: (previous) => ({ ...previous, create: true }) })}
            >
              Register customer
            </Button>
          ) : undefined
        }
      />

      <CustomerRegistry key={orgSlug} orgSlug={orgSlug} />

      {canRegister ? (
        <CustomerSheet
          orgSlug={orgSlug}
          open={create === true}
          // The sheet opens from the URL, not a trigger inside it, so nothing hands focus
          // back to the button that opened it.
          onOpenChange={(open) => {
            void navigate({
              search: (previous) => ({ ...previous, create: open ? true : undefined }),
            }).then(() => {
              if (!open) registerTrigger.current?.focus();
            });
          }}
        />
      ) : null}
    </>
  );
}
