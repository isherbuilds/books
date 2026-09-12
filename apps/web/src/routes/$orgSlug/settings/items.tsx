import { Badge } from "@accly/ui/components/badge";
import { Button } from "@accly/ui/components/button";
import { Checkbox } from "@accly/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@accly/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import { SubmitButton } from "@accly/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  FilterGroup,
  FilterSelect,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { MONEY_INPUT_PATTERN } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

// Mirrors ITEM_CATEGORIES in @accly/db, kept local so no server schema module
// reaches the client bundle (hard rule 6).
const ITEM_CATEGORIES = ["consultation", "procedure", "lab", "radiology", "other"] as const;

type ItemCategory = (typeof ITEM_CATEGORIES)[number];

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  lab: "Lab",
  radiology: "Radiology",
  other: "Other",
};

const itemListQuery = (
  orgSlug: string,
  filters: { query: string; category?: ItemCategory; activeOnly: boolean },
) =>
  orpc.item.list.infiniteOptions({
    input: (cursor: { name: string; id: string } | undefined) => ({
      orgSlug,
      query: filters.query || undefined,
      category: filters.category,
      activeOnly: filters.activeOnly,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/settings/items")({
  head: () => ({ meta: [{ title: "Item · Accly Books" }] }),
  validateSearch: z.object({
    category: z.enum(ITEM_CATEGORIES).optional().catch(undefined),
    activeOnly: z.boolean().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ category: search.category, activeOnly: search.activeOnly }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    // Reading the item is org-wide; this page only edits it, so the tab strip gates
    // it on `update` too.
    await requireOrgPermission(queryClient, orgSlug, { item: ["update"] }, "/$orgSlug/settings");
    await queryClient
      .infiniteQuery(
        itemListQuery(orgSlug, {
          query: "",
          category: deps.category,
          activeOnly: deps.activeOnly ?? false,
        }),
      )
      .catch(() => {});
  },
  component: ItemRoute,
});

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Keep the name under 200 characters"),
  code: z.string().trim().min(1, "Code is required").max(20, "Keep the code under 20 characters"),
  category: z.enum(ITEM_CATEGORIES),
  unitPrice: z.string().regex(MONEY_INPUT_PATTERN, "Amount like 150 or 150.00"),
  taxRatePercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Rate like 0, 5, or 12.50"),
  taxCode: z.string().trim().max(20, "Keep the tax code under 20 characters").optional(),
  active: z.boolean(),
});

type ItemFormValues = z.infer<typeof formSchema>;

type Item = {
  id: string;
  name: string;
  code: string;
  category: ItemCategory;
  unitPrice: string;
  taxRatePercent: string;
  taxCode: string | null;
  active: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const EMPTY_VALUES: ItemFormValues = {
  name: "",
  code: "",
  category: "consultation",
  unitPrice: "",
  taxRatePercent: "0",
  taxCode: "",
  active: true,
};

function ItemRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  // Filters live in the URL, so a filtered view is shareable and Back restores it.
  const { category, activeOnly } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const toggleActive = useMutation(
    orpc.item.update.mutationOptions({
      onMutate: async (variables) => {
        const queryKey = orpc.item.list.key({ input: { orgSlug }, type: "infinite" });
        await queryClient.cancelQueries({ queryKey });

        const snapshot = queryClient.getQueriesData<
          InfiniteData<{
            items: Item[];
            nextCursor: { name: string; id: string } | null;
          }>
        >({ queryKey });

        queryClient.setQueriesData<
          InfiniteData<{
            items: Item[];
            nextCursor: { name: string; id: string } | null;
          }>
        >({ queryKey }, (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    item.id === variables.itemId ? { ...item, active: variables.active } : item,
                  ),
                })),
              }
            : data,
        );

        return { snapshot };
      },
      onError: (error, _variables, context) => {
        for (const [queryKey, data] of context?.snapshot ?? []) {
          queryClient.setQueryData(queryKey, data);
        }

        toast.error(errorMessage(error, "Could not update item item"));
      },
      onSettled: () => {
        // The settling mutation still counts as pending, so >1 means a sibling update is in
        // flight and refetching now would overwrite its optimistic patch.
        const pending = queryClient.isMutating({
          mutationKey: orpc.item.update.mutationKey(),
        });

        if (pending > 1) return;

        return queryClient.invalidateQueries({
          queryKey: orpc.item.list.key({ input: { orgSlug } }),
        });
      },
    }),
  );

  const mutateToggle = toggleActive.mutate;

  const toggleItem = useCallback(
    (item: Item) =>
      mutateToggle({
        orgSlug,
        itemId: item.id,
        name: item.name,
        code: item.code,
        category: item.category,
        unitPrice: item.unitPrice,
        taxRatePercent: item.taxRatePercent,
        taxCode: item.taxCode,
        active: !item.active,
      }),
    [mutateToggle, orgSlug],
  );

  const item = useInfiniteQuery(
    itemListQuery(orgSlug, {
      query,
      category,
      activeOnly: activeOnly ?? false,
    }),
  );

  const items = item.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Service item"
        description="Manage billable services, prices, and tax details"
        action={<Button onClick={() => setCreateOpen(true)}>New item</Button>}
      />
      <SettingsTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search item"
            placeholder="Search code or name"
            onQueryChange={setQuery}
          />
          {/* A select, not a toggle group: categories are data, not a fixed set. */}
          <FilterSelect<"all" | ItemCategory>
            label="Category"
            value={category ?? "all"}
            options={[
              { value: "all", label: "All categories" },
              ...ITEM_CATEGORIES.map((value) => ({
                value,
                label: CATEGORY_LABELS[value],
              })),
            ]}
            onValueChange={(next) => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  category: next === "all" ? undefined : next,
                }),
                replace: true,
              });
            }}
          />
          <FilterGroup<"all" | "active">
            label="Status"
            value={activeOnly ? "active" : "all"}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
            ]}
            onValueChange={(next) => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  activeOnly: next === "active" ? true : undefined,
                }),
                replace: true,
              });
            }}
          />
        </ListToolbar>

        <Panel label="Items" footer={<LoadMore query={item} shown={items.length} />}>
          <ListState
            query={item}
            errorTitle="Could not load service item"
            isEmpty={items.length === 0}
            empty={
              query
                ? "No item items match this search."
                : category || activeOnly
                  ? "No item items match these filters."
                  : "No item items yet."
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Tax %</TableHead>
                  <TableHead>Tax code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    pending={toggleActive.isPending && toggleActive.variables?.itemId === item.id}
                    onToggle={toggleItem}
                    onEdit={setEditing}
                  />
                ))}
              </TableBody>
            </Table>
          </ListState>
        </Panel>
      </PageBody>

      <ItemDialog mode="create" orgSlug={orgSlug} open={createOpen} onOpenChange={setCreateOpen} />
      {editing ? (
        <ItemDialog
          key={editing.id}
          mode="edit"
          orgSlug={orgSlug}
          item={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Memoized so an optimistic toggle re-renders one row, not the whole item. */
const ItemRow = memo(function ItemRow({
  item,
  pending,
  onToggle,
  onEdit,
}: {
  item: Item;
  pending: boolean;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-mono">{item.code}</TableCell>
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell>{CATEGORY_LABELS[item.category]}</TableCell>
      <TableCell className="text-right tabular-nums">{item.unitPrice}</TableCell>
      <TableCell className="text-right tabular-nums">{item.taxRatePercent}</TableCell>
      <TableCell className="font-mono">{item.taxCode || "—"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={item.active}
            disabled={pending}
            aria-label={`Set ${item.name} ${item.active ? "inactive" : "active"}`}
            onCheckedChange={() => onToggle(item)}
          />
          <Badge variant={item.active ? "secondary" : "muted"}>
            {item.active ? "Active" : "Inactive"}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="xs" onClick={() => onEdit(item)}>
          Edit
        </Button>
      </TableCell>
    </TableRow>
  );
});

type ItemDialogProps =
  | {
      mode: "create";
      orgSlug: string;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }
  | {
      mode: "edit";
      orgSlug: string;
      item: Item;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    };

function ItemDialog(props: ItemDialogProps) {
  const { mode, orgSlug, open, onOpenChange } = props;
  const queryClient = useQueryClient();
  const item = mode === "edit" ? props.item : null;

  const form = useZodForm(formSchema, {
    defaultValues: item
      ? {
          name: item.name,
          code: item.code,
          category: item.category,
          unitPrice: item.unitPrice,
          taxRatePercent: item.taxRatePercent,
          taxCode: item.taxCode ?? "",
          active: item.active,
        }
      : EMPTY_VALUES,
  });

  // Awaiting the refetch keeps the mutation pending, so the dialog closes onto a list
  // that is already correct.
  const closeAfterSuccess = async (message: string) => {
    await queryClient.invalidateQueries({
      queryKey: orpc.item.list.key({ input: { orgSlug } }),
    });
    toast.success(message);
    onOpenChange(false);
    form.reset(item ? undefined : EMPTY_VALUES);
  };

  const handleError = (error: unknown) => {
    const mapped = applyOrpcFieldError(form, error, {
      duplicate: { field: "code", message: "Code already in use" },
    });

    toast.error(mapped ?? errorMessage(error, "Could not save item item"));
  };

  const create = useMutation(
    orpc.item.create.mutationOptions({
      onSuccess: () => closeAfterSuccess("Item item created"),
      onError: handleError,
    }),
  );

  const update = useMutation(
    orpc.item.update.mutationOptions({
      onSuccess: () => closeAfterSuccess("Item item updated"),
      onError: handleError,
    }),
  );

  const onSubmit = form.handleSubmit((values) => {
    const shared = {
      orgSlug,
      name: values.name,
      code: values.code,
      category: values.category,
      unitPrice: values.unitPrice,
      taxRatePercent: values.taxRatePercent,
      taxCode: values.taxCode || null,
    };

    if (item) {
      update.mutate({ ...shared, itemId: item.id, active: values.active });
    } else {
      create.mutate(shared);
    }
  });

  const isPending = create.isPending || update.isPending;

  const changeOpen = (next: boolean) => {
    if (!next && !isPending) {
      form.reset(item ? undefined : EMPTY_VALUES);
      onOpenChange(false);
    } else if (next) {
      onOpenChange(true);
    }
  };

  return (
    <ClientOnly fallback={null}>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{item ? "Edit item item" : "New item item"}</DialogTitle>
            <DialogDescription>
              {item
                ? "Update pricing, tax details, or whether this item is available."
                : "Add a billable service to this organization's item."}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <RegisteredFormField
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={isPending} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={isPending} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} disabled={isPending}>
                          {ITEM_CATEGORIES.map((option) => (
                            <option key={option} value={option}>
                              {CATEGORY_LABELS[option]}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="unitPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit price</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="decimal"
                          placeholder="150.00"
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="taxRatePercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax %</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="decimal"
                          placeholder="0"
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RegisteredFormField
                  name="taxCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax code (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={isPending} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {item ? (
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormLabel>Active</FormLabel>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => changeOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <SubmitButton isSubmitting={isPending}>
                  {item ? "Save changes" : "Create item"}
                </SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ClientOnly>
  );
}
