import {
  Form,
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Button } from "@accly/ui/components/button";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import { SheetFooter } from "@accly/ui/components/sheet";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { Textarea } from "@accly/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, MailIcon, PhoneIcon } from "lucide-react";
import { useState, type FormEventHandler, type ReactNode } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateCustomerState } from "@/lib/domain-invalidation";
import {
  optionalNumberText,
  optionalText,
  customerFieldSchema,
  type CustomerFields,
} from "@/lib/form-schema";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage } from "@/lib/orpc-error";
import type { PayerType } from "@/lib/payer";
import { ageYearsToEstimatedDateOfBirth, customerAgeYears } from "@/lib/customer-age";

const customerFormSchema = customerFieldSchema
  .omit({ dobEstimated: true })
  .extend({
    dateOfBirth: optionalText(customerFieldSchema.shape.dateOfBirth),
    age: optionalNumberText(z.number().int().min(0).max(150)),
    sponsorPayerId: z.string(),
    sponsorPolicyNumber: z.string().trim().max(100),
    sponsorEmployeeNumber: z.string().trim().max(100),
  })
  .refine((values) => values.dateOfBirth !== null || values.age !== null, {
    message: "Enter a date of birth or age",
    path: ["dateOfBirth"],
  });

type CustomerFormValues = z.input<typeof customerFormSchema>;

const UID_CONFLICT = {
  uid_taken: { field: "uid", message: "A customer with this UID already exists." },
} as const;

/** The record the form edits. `updatedAt` is the compare-and-swap token the save needs. */
export type EditableCustomer = CustomerFields & {
  id: string;
  code: string;
  updatedAt: string;
  sponsor: {
    payerId: string;
    payerName: string;
    payerType: PayerType;
    policyNumber: string | null;
    employeeNumber: string | null;
  } | null;
};

/** Controls are uncontrolled, so every default is the string the DOM holds. */
function defaultValues(
  customer: EditableCustomer | undefined,
  seed: { name?: string; phone?: string } | undefined,
  today: string,
): CustomerFormValues {
  if (!customer) {
    return {
      name: seed?.name ?? "",
      phone: seed?.phone ?? "",
      sex: "",
      dateOfBirth: "",
      age: "",
      address: "",
      email: "",
      uid: "",
      sponsorPayerId: "",
      sponsorPolicyNumber: "",
      sponsorEmployeeNumber: "",
    };
  }

  return {
    name: customer.name,
    phone: customer.phone,
    sex: customer.sex,
    // An estimated birth date was computed from an age, so it is offered back as the
    // age. Editing it as a date would turn a guess into a fact.
    dateOfBirth: customer.dobEstimated ? "" : customer.dateOfBirth,
    age: customer.dobEstimated ? String(customerAgeYears(customer.dateOfBirth, today)) : "",
    address: customer.address,
    email: customer.email ?? "",
    uid: customer.uid ?? "",
    sponsorPayerId: customer.sponsor?.payerId ?? "",
    sponsorPolicyNumber: customer.sponsor?.policyNumber ?? "",
    sponsorEmployeeNumber: customer.sponsor?.employeeNumber ?? "",
  };
}

/** Inputs only — a textarea has no vertical centre to hang a glyph on. */
function WithIcon({ icon: Icon, children }: { icon: typeof PhoneIcon; children: ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      {children}
    </div>
  );
}

function CustomerPhoneDuplicateWarning({
  orgSlug,
  selfId,
}: {
  orgSlug: string;
  /** The record being edited: its own number is not a duplicate of itself. */
  selfId: string | undefined;
}) {
  const { control } = useFormContext<CustomerFormValues>();
  const phone = useWatch({ control, name: "phone", exact: true });
  const debouncedPhone = useDebouncedValue(phone.trim(), 300);

  const duplicates = useQuery({
    ...orpc.customer.search.queryOptions({
      input: { orgSlug, phone: debouncedPhone, limit: 100 },
    }),
    enabled: debouncedPhone.length >= 4,
  });

  const matches =
    phone.trim() === debouncedPhone && debouncedPhone.length >= 4
      ? (duplicates.data?.items ?? []).filter((customer) => customer.id !== selfId)
      : [];

  return matches.length > 0 ? (
    <div
      role="status"
      className="animate-in rounded-lg border border-border bg-muted p-3 text-xs duration-150 fade-in-0 ease-out"
    >
      <p className="flex items-center gap-2 font-medium text-foreground">
        <AlertTriangleIcon className="size-4 shrink-0" />
        {matches.length} existing customer(s) with this phone
      </p>
      <ul className="flex flex-col gap-1 pt-2">
        {matches.map((customer) => (
          <li key={customer.id} className="text-muted-foreground">
            <Link
              to="/$orgSlug/customers/$customerId"
              params={{ orgSlug, customerId: customer.id }}
              className="font-mono underline underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
            >
              {customer.code}
            </Link>{" "}
            {customer.name}
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

/** Its own component so the error count does not re-render the whole form. */
function CustomerFormProblems() {
  const { control } = useFormContext<CustomerFormValues>();
  const { errors } = useFormState({ control });
  const problems = Object.keys(errors).length;

  return problems > 0 ? (
    <span className="min-w-0 truncate text-destructive">
      {problems} {problems === 1 ? "field needs" : "fields need"} fixing
    </span>
  ) : null;
}

function CustomerFormFrame({
  pending,
  onCancel,
  onSubmit,
  children,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}) {
  const { control } = useFormContext<CustomerFormValues>();
  // Only `isDirty`: it flips once, so per-field errors stay inside the leaves.
  const { isDirty } = useFormState({ control });

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      data-dirty={isDirty}
      className="flex min-h-0 flex-1 flex-col"
    >
      <fieldset disabled={pending} className="contents">
        {/* `scroll-rule` draws the hairline above the actions in CSS: there
            while the form is taller than the panel, gone once the last field
            is in view. */}
        <div className="scroll-rule min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        <SheetFooter>
          <CustomerFormProblems />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={pending}>Save</SubmitButton>
          </div>
        </SheetFooter>
      </fieldset>
    </form>
  );
}

function SponsorFields({
  orgSlug,
  current,
}: {
  orgSlug: string;
  /** The sponsor already on the record, kept selectable even once deactivated. */
  current: string | undefined;
}) {
  const { control } = useFormContext<CustomerFormValues>();
  const payerId = useWatch({ control, name: "sponsorPayerId", exact: true });
  const payers = useQuery(orpc.payer.list.queryOptions({ input: { orgSlug } }));
  const list = payers.data ?? [];
  // A deactivated payer takes no new links, so it is offered only to the record that
  // already holds it — otherwise its name silently disappears and the save drops it.
  const options = list.filter((payer) => payer.active || payer.id === current);

  const inactive =
    !payers.isPending &&
    payerId !== "" &&
    !list.some((payer) => payer.id === payerId && payer.active);

  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
      <legend className="pr-2 text-sm font-medium">Sponsor</legend>
      <RegisteredFormField
        name="sponsorPayerId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Covered by</FormLabel>
            <FormControl>
              <NativeSelect {...field}>
                <option value="">Self-paying</option>
                {options.map((payer) => (
                  <option key={payer.id} value={payer.id}>
                    {payer.name}
                    {payer.active ? "" : " (inactive)"}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
            <FormDescription>
              {payers.isPending ? (
                "Loading payers…"
              ) : options.length === 0 ? (
                <>
                  No payers are set up yet.{" "}
                  <Link
                    to="/$orgSlug/settings/payers"
                    params={{ orgSlug }}
                    className="underline underline-offset-4"
                  >
                    Add one in settings
                  </Link>
                  .
                </>
              ) : (
                "The bill is still addressed to the customer; an uncovered balance stays outstanding."
              )}
            </FormDescription>
            {inactive ? (
              <p className="text-xs text-destructive">
                This payer is no longer active. Choose another before saving.
              </p>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />
      {payerId ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RegisteredFormField
            name="sponsorPolicyNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Policy number</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <RegisteredFormField
            name="sponsorEmployeeNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Employee number</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

export function CustomerForm({
  orgSlug,
  customer,
  seed,
  onCancel,
  onSaved,
  onRegistered,
}: {
  orgSlug: string;
  /** Set to edit an existing record; absent registers a new one. */
  customer?: EditableCustomer;
  /** What the operator already typed elsewhere, so it is never keyed twice. */
  seed?: { name?: string; phone?: string };
  onCancel: () => void;
  onSaved: () => void;
  /** Set when the caller needs the record back rather than a trip to its page. */
  onRegistered?: (customer: { id: string; name: string; code: string }) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { today } = useOrgDateTime();
  // Frozen at mount. The page behind this sheet refetches on focus, so a live prop
  // would hand the save a compare-and-swap token newer than the values on screen and
  // quietly overwrite whoever changed the record meanwhile.
  const [record] = useState(customer);

  const form = useZodForm(customerFormSchema, {
    defaultValues: defaultValues(record, seed, today),
  });

  const register = useMutation(
    orpc.customer.register.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({
          queryKey: orpc.customer.search.key({ input: { orgSlug } }),
        });
        toast.success(`Customer registered as ${created.code}`);

        // Registering inside another task hands the record straight back.
        if (onRegistered) {
          onRegistered(created);
          onSaved();

          return;
        }

        await navigate({
          to: "/$orgSlug/customers/$customerId",
          params: { orgSlug, customerId: created.id },
          ignoreBlocker: true,
        });
      },
      onError: (error) => {
        const mapped = applyOrpcFieldError(form, error, UID_CONFLICT);
        toast.error(mapped ?? errorMessage(error, "Could not register the customer"));
      },
    }),
  );

  const update = useMutation(
    orpc.customer.update.mutationOptions({
      onSuccess: async (saved) => {
        await invalidateCustomerState(queryClient, orgSlug, saved.id);
        toast.success("Changes saved");
        onSaved();
      },
      onError: (error) => {
        // A stale token means the record moved under the open sheet, so this save would
        // overwrite whoever got there first. Closing and reopening is the only honest
        // recovery: it is what rebuilds the form from the record as it now stands.
        const mapped = applyOrpcFieldError(form, error, UID_CONFLICT);
        toast.error(mapped ?? errorMessage(error, "Could not save the changes"));
      },
    }),
  );

  const pending = register.isPending || update.isPending;

  const onSubmit = form.handleSubmit(
    ({ age, sponsorPayerId, sponsorPolicyNumber, sponsorEmployeeNumber, ...fields }) => {
      const dateOfBirth =
        fields.dateOfBirth ?? (age === null ? null : ageYearsToEstimatedDateOfBirth(age, today));

      if (dateOfBirth === null) {
        form.setError("dateOfBirth", { message: "Enter a date of birth or age" });

        return;
      }

      // The procedure takes the whole record, not a patch, so both paths send the
      // same body — the update adds only the id and the token it must match.
      const values = {
        orgSlug,
        ...fields,
        dateOfBirth,
        dobEstimated: age !== null,
        sponsor: sponsorPayerId
          ? {
              payerId: sponsorPayerId,
              policyNumber: sponsorPolicyNumber || undefined,
              employeeNumber: sponsorEmployeeNumber || undefined,
            }
          : null,
      };

      if (record) {
        update.mutate({ ...values, customerId: record.id, updatedAt: record.updatedAt });

        return;
      }

      register.mutate(values);
    },
  );

  return (
    <Form {...form}>
      {/* `noValidate`: Zod owns every message, so the browser must not pre-empt
          it with a native bubble that says something different. Without it a
          half-typed email blocks submit silently and the form looks dead. */}
      {/* The dirty flag the sheet needs to guard a close, published on the element
          instead of lifted into its state — see `CustomerSheet`. */}
      <CustomerFormFrame pending={pending} onCancel={onCancel} onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <RegisteredFormField
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input
                    {...field}

                    autoComplete="name"
                    placeholder="Enter the customer's name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <WithIcon icon={PhoneIcon}>
                    <Input
                      {...field}
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="Mobile number"
                      className="pl-8"
                    />
                  </WithIcon>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <CustomerPhoneDuplicateWarning orgSlug={orgSlug} selfId={record?.id} />

          <RegisteredFormField
            name="sex"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Sex <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="">Choose sex</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="unknown">Unknown</option>
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date of birth</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="date"
                    onChange={(event) => {
                      field.onChange(event);

                      if (event.target.value !== "") form.setValue("age", "");
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="age"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Age in years, if birth date is unknown</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    max={150}
                    placeholder="Enter an estimated age"
                    onChange={(event) => {
                      field.onChange(event);

                      if (event.target.value !== "") form.setValue("dateOfBirth", "");
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <WithIcon icon={MailIcon}>
                    <Input
                      {...field}
                      type="email"
                      autoComplete="email"
                      placeholder="Enter email address"
                      className="pl-8"
                    />
                  </WithIcon>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="uid"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tax ID / GSTIN</FormLabel>
                <FormControl>
                  <Input {...field} className="font-mono" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={2} placeholder="Enter address" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <SponsorFields orgSlug={orgSlug} current={record?.sponsor?.payerId} />
        </div>
      </CustomerFormFrame>
    </Form>
  );
}
