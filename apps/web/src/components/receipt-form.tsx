import { NON_NEGATIVE_MONEY_PATTERN } from "@accly/api/core/money";
import type { ReceiptDetail } from "@accly/api/routers/receipt";
import { Button, buttonVariants } from "@accly/ui/components/button";
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
import { SheetFooter } from "@accly/ui/components/sheet";
import { Textarea } from "@accly/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

import { LinkField } from "@/components/link-field";
import { PartyLinkField } from "@/components/party-link-field";
import { useZodForm } from "@/hooks/use-zod-form";
import { useWatch } from "react-hook-form";
import { invalidateReceiptState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { errorMessage, errorReason } from "@/lib/orpc-error";

const receiptSchema = z
  .object({
    partyId: z.string().nullable(),
    partyName: z.string(),
    amount: z
      .string()
      .regex(NON_NEGATIVE_MONEY_PATTERN, "Enter a valid amount")
      .refine((value) => Number(value) > 0, "Amount must be greater than zero"),
    paymentMethodId: z.string().min(1, "Choose a payment method"),
    settlementKind: z.enum(["advance", "direct"]),
    advanceSupply: z.enum(["goods", "exempt", "taxableService"]).nullable(),
    incomeAccountId: z.string().nullable(),
    reference: z.string().trim().max(120, "Reference must be 120 characters or fewer"),
    narration: z.string().trim().max(500, "Narration must be 500 characters or fewer"),
    documentDate: z.iso.date(),
  })
  .superRefine((values, context) => {
    if (values.settlementKind === "advance" && !values.partyId) {
      context.addIssue({ code: "custom", path: ["partyId"], message: "Choose a party" });
    }

    if (values.settlementKind === "advance" && !values.advanceSupply) {
      context.addIssue({
        code: "custom",
        path: ["advanceSupply"],
        message: "Choose what the advance is for",
      });
    }

    if (values.settlementKind === "direct" && !values.incomeAccountId) {
      context.addIssue({
        code: "custom",
        path: ["incomeAccountId"],
        message: "Choose an income account",
      });
    }
  });

type ReceiptFormValues = z.input<typeof receiptSchema>;

function defaults(today: string, paymentMethodId = ""): ReceiptFormValues {
  return {
    partyId: null,
    partyName: "",
    amount: "",
    paymentMethodId,
    settlementKind: "advance",
    advanceSupply: null,
    incomeAccountId: null,
    reference: "",
    narration: "",
    documentDate: today,
  };
}

export function ReceiptForm({
  orgSlug,
  today,
  onClose,
}: {
  orgSlug: string;
  today: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const partyRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const incomeAccountRef = useRef<HTMLInputElement>(null);

  // After a Link Field commits, continue in DOM order like Enter in any other field.
  const focusAfter = (from: Element | null) => {
    const controls = Array.from(
      formRef.current?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
      >("input,select,textarea,button") ?? [],
    ).filter(
      (control) => !control.disabled && control.tabIndex >= 0 && control.offsetParent !== null,
    );

    const index = controls.findIndex((control) => control === from);
    controls[index + 1]?.focus();
  };

  const [posted, setPosted] = useState<ReceiptDetail | null>(null);
  const form = useZodForm(receiptSchema, { defaultValues: defaults(today) });

  // The receipts list's cache entry; only an active method can take a new receipt.
  const paymentMethods = useQuery({
    ...orpc.paymentMethod.list.queryOptions({ input: { orgSlug } }),
    staleTime: 5 * 60_000,
    select: (methods) => methods.filter((method) => method.active),
  });

  const incomeAccounts = useQuery({
    ...orpc.account.list.queryOptions({ input: { orgSlug, type: "income", activeOnly: true } }),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (form.getValues("paymentMethodId") || !paymentMethods.data?.length) return;

    const preferred =
      paymentMethods.data.find((method) => method.name.toLocaleLowerCase() === "bank transfer") ??
      paymentMethods.data[0];

    form.setValue("paymentMethodId", preferred.id);
  }, [form, paymentMethods.data]);

  const post = useMutation(
    orpc.receipt.post.mutationOptions({
      onSuccess: (receipt) => {
        setPosted(receipt);
        void invalidateReceiptState(queryClient, orgSlug, receipt.id);
      },
      onError: (error) => {
        const reason = errorReason(error);

        const field =
          reason === "PARTY_INVALID"
            ? "partyId"
            : reason === "INCOME_ACCOUNT_INVALID" || reason === "TAXABLE_DIRECT_RECEIPT"
              ? "incomeAccountId"
              : reason === "ADVANCE_TAX_UNSUPPORTED"
                ? "advanceSupply"
                : reason === "PAYMENT_METHOD_INVALID"
                  ? "paymentMethodId"
                  : undefined;

        if (field) {
          form.setError(field, { message: errorMessage(error) }, { shouldFocus: true });

          return;
        }

        toast.error(errorMessage(error, "Could not post the receipt"));
      },
    }),
  );

  const submit = form.handleSubmit((values) => {
    const common = {
      orgSlug,
      amount: values.amount,
      paymentMethodId: values.paymentMethodId,
      reference: values.reference,
      narration: values.narration,
      documentDate: values.documentDate,
    };

    if (values.settlementKind === "advance") {
      if (!values.partyId || !values.advanceSupply) return;

      post.mutate({
        ...common,
        settlementKind: "advance",
        partyId: values.partyId,
        advanceSupply: values.advanceSupply,
      });

      return;
    }

    if (!values.incomeAccountId) return;

    post.mutate({
      ...common,
      settlementKind: "direct",
      partyId: values.partyId ?? undefined,
      incomeAccountId: values.incomeAccountId,
    });
  });

  // The posted view unmounts the fields, so Party is focused after the form
  // returns; a frame later, so the Dialog's focus guard has settled.
  const settlementKind = useWatch({ control: form.control, name: "settlementKind" });
  const incomeAccountId = useWatch({ control: form.control, name: "incomeAccountId" });

  const selectedIncomeAccount =
    incomeAccounts.data?.find((account) => account.id === incomeAccountId) ?? null;

  const focusPartyNext = useRef(false);

  useEffect(() => {
    if (posted || !focusPartyNext.current) return;

    focusPartyNext.current = false;

    // Base UI moves focus to the dialog when the clicked button unmounts; land after it.
    const timer = setTimeout(() => partyRef.current?.focus(), 50);

    return () => clearTimeout(timer);
  }, [posted]);

  const handlePostAndNext = () => {
    const { documentDate, paymentMethodId } = form.getValues();
    form.reset(defaults(documentDate, paymentMethodId));
    post.reset();
    focusPartyNext.current = true;
    setPosted(null);
  };

  // React bubbles portal events through the tree, so the quick-create sheet's
  // keys and submit would reach this form; only handle events from its own DOM.
  const ownEvent = (event: SyntheticEvent<HTMLFormElement>) =>
    event.target instanceof Node && event.currentTarget.contains(event.target);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!ownEvent(event)) return;
    void submit(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (!ownEvent(event) || event.defaultPrevented) return;

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();

      if (!post.isPending) void submit();

      return;
    }

    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;

    const target = event.target;

    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;

    event.preventDefault();
    focusAfter(target);
  };

  if (posted) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid flex-1 place-content-center gap-3 overflow-y-auto p-4 text-center">
          <p className="text-muted-foreground">Posted</p>
          <p className="font-mono text-sm font-medium">{posted.number}</p>
          <a
            href={`/api/${orgSlug}/receipts/${posted.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline", className: "mx-auto" })}
          >
            Print
          </a>
        </div>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button type="button" onClick={handlePostAndNext}>
            Post and next
          </Button>
        </SheetFooter>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        className="flex min-h-0 flex-1 flex-col"
      >
        <fieldset disabled={post.isPending} className="contents">
          <div className="grid gap-3 overflow-y-auto p-4">
            <FormField
              control={form.control}
              name="partyId"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Party{settlementKind === "direct" ? " (optional)" : ""}</FormLabel>
                  <FormControl>
                    <PartyLinkField
                      orgSlug={orgSlug}
                      value={
                        field.value ? { id: field.value, name: form.getValues("partyName") } : null
                      }
                      onSelect={(party) => {
                        field.onChange(party?.id ?? null);
                        form.setValue("partyName", party?.name ?? "");
                      }}
                      inputRef={partyRef}
                      onCommit={() => focusAfter(partyRef.current)}
                      clearable={settlementKind === "direct"}
                      aria-invalid={fieldState.invalid}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <RegisteredFormField
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        required
                        inputMode="decimal"
                        autoComplete="off"
                        pattern={NON_NEGATIVE_MONEY_PATTERN.source}
                        placeholder="0.00"
                        className="tabular-nums"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentMethodId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment method</FormLabel>
                    <FormControl>
                      <NativeSelect {...field} required>
                        <option value="" disabled>
                          {paymentMethods.isPending
                            ? "Loading payment methods…"
                            : paymentMethods.isError
                              ? "Could not load payment methods"
                              : "Choose a payment method"}
                        </option>
                        {paymentMethods.data?.map((method) => (
                          <option key={method.id} value={method.id}>
                            {method.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="settlementKind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Settlement kind</FormLabel>
                  <FormControl>
                    <ToggleGroup
                      value={[field.value]}
                      onValueChange={(next) => {
                        const value = next[0];

                        if (value === "advance" || value === "direct") field.onChange(value);
                      }}
                      spacing={1}
                      variant="outline"
                      aria-label="Settlement kind"
                    >
                      <ToggleGroupItem value="advance">Advance</ToggleGroupItem>
                      <ToggleGroupItem value="direct">Direct</ToggleGroupItem>
                    </ToggleGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {settlementKind === "direct" ? (
              <FormField
                control={form.control}
                name="incomeAccountId"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Income account</FormLabel>
                    <FormControl>
                      <LinkField
                        items={incomeAccounts.data}
                        query={incomeAccounts}
                        noun="income accounts"
                        getKey={(account) => account.id}
                        getLabel={(account) => account.name}
                        getCode={(account) => account.code}
                        value={selectedIncomeAccount}
                        onSelect={(account) => field.onChange(account?.id ?? null)}
                        inputRef={incomeAccountRef}
                        onCommit={() => focusAfter(incomeAccountRef.current)}
                        placeholder="Choose an income account"
                        aria-invalid={fieldState.invalid}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {settlementKind === "advance" ? (
              <FormField
                control={form.control}
                name="advanceSupply"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advance for</FormLabel>
                    <FormControl>
                      <NativeSelect
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(event.target.value === "" ? null : event.target.value)
                        }
                        required
                      >
                        <option value="" disabled>
                          Choose supply
                        </option>
                        <option value="goods">Goods</option>
                        <option value="exempt">Exempt supply</option>
                        <option value="taxableService">Taxable service</option>
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <RegisteredFormField
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={120} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <RegisteredFormField
              name="narration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Narration</FormLabel>
                  <FormControl>
                    <Textarea {...field} maxLength={500} rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <RegisteredFormField
              name="documentDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input {...field} required type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {post.isPending ? "Posting…" : post.isError ? "Post again" : "Post"}
              <span className="text-[0.625rem] opacity-70">⌘↵</span>
            </Button>
          </SheetFooter>
        </fieldset>
      </form>
    </Form>
  );
}
