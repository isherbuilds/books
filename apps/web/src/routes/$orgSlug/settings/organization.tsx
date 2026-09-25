import {
  documentPrefix,
  pan,
  optionalGstin,
  indianStateCode,
  indianPinCode,
  validateGstinIdentity,
} from "@accly/api/lib/schemas";
import type { SettingsFields } from "@accly/api/routers/settings";
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
import { SubmitButton } from "@accly/ui/components/submit-button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useFormState } from "react-hook-form";
import { z } from "zod";

import { OptionField, STATE_OPTIONS, type Option } from "@/components/option-field";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateSettings } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

const PREFIX_FIELDS = [
  ["invoicePrefix", "Invoice"],
  ["billPrefix", "Bill"],
  ["receiptPrefix", "Receipt"],
  ["paymentPrefix", "Payment"],
  ["journalPrefix", "Journal"],
  ["creditNotePrefix", "Credit note"],
  ["debitNotePrefix", "Debit note"],
] as const;

export const Route = createFileRoute("/$orgSlug/settings/organization")({
  head: () => ({ meta: [{ title: "Organization · Accly Books" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    // The page is a save form, so the tab strip gates it on `update` too.
    await requireOrgPermission(queryClient, orgSlug, { settings: ["update"] });
    await queryClient.query(orpc.settings.get.queryOptions({ input: { orgSlug } })).catch(() => {});
  },
  component: SettingsRoute,
});

const formSchema = z
  .object({
    legalName: z
      .string()
      .trim()
      .min(1, "Enter the legal name")
      .max(200, "Keep the legal name under 200 characters"),
    pan,
    gstin: optionalGstin.unwrap(),
    stateCode: indianStateCode,
    addressLine1: z
      .string()
      .trim()
      .min(1, "Enter the registered address")
      .max(200, "Keep the address under 200 characters"),
    addressLine2: z
      .string()
      .trim()
      .max(200, "Keep the address under 200 characters")
      .transform((value) => value || undefined),
    city: z.string().trim().min(1, "Enter the city").max(120, "Keep the city under 120 characters"),
    pinCode: indianPinCode,
    financialYearStart: z
      .string()
      .refine((raw) => raw.trim() !== "", "Enter a number")
      .transform(Number)
      .pipe(z.number().int().min(1, "Pick a month").max(12, "Pick a month")),
    invoicePrefix: documentPrefix,
    billPrefix: documentPrefix,
    receiptPrefix: documentPrefix,
    paymentPrefix: documentPrefix,
    creditNotePrefix: documentPrefix,
    debitNotePrefix: documentPrefix,
    journalPrefix: documentPrefix,
  })
  .superRefine(validateGstinIdentity);

function toFormValues(settings: SettingsFields) {
  return {
    ...settings,
    gstin: settings.gstin ?? "",
    addressLine2: settings.addressLine2 ?? "",
    financialYearStart: String(settings.financialYearStart),
  };
}

const MONTH_OPTIONS: Option[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map((name, index) => ({ code: String(index + 1), name }));

function SettingsRoute() {
  const { orgSlug } = Route.useParams();
  const settings = useQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));

  return (
    <>
      <PageHeader
        title="Organization"
        description="Legal identity and document numbering for this organization"
      />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody className="max-w-2xl">
        {settings.isError && <ErrorNote title="Could not load settings" error={settings.error} />}

        {settings.data && (
          // Keyed by tenant: switching organizations remounts the form instead of carrying
          // dirty state across.
          <SettingsForm key={orgSlug} orgSlug={orgSlug} defaults={settings.data} />
        )}
      </PageBody>
    </>
  );
}

function SettingsForm({ orgSlug, defaults }: { orgSlug: string; defaults: SettingsFields }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const form = useZodForm(formSchema, { defaultValues: toFormValues(defaults) });
  const { isDirty } = useFormState({ control: form.control });

  const update = useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: async (saved) => {
        form.reset(toFormValues(saved));
        toast.success("Settings saved");
        // Awaited: the org layout loader holds `member.me`, so open pages would keep
        // the old financial year until staleTime lapses.
        await invalidateSettings(queryClient, orgSlug);
        await router.invalidate();
      },
      onError: (error) =>
        applyOrpcFieldError(
          form,
          error,
          { FINANCIAL_YEAR_FIXED: "financialYearStart" },
          "Could not save the settings",
        ),
    }),
  );

  const onSubmit = form.handleSubmit((values) => update.mutate({ orgSlug, ...values }));

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {/* Frozen while saving: `onSuccess` resets to the saved row, which would
            otherwise discard anything typed during the request. */}
        <fieldset disabled={update.isPending} className="contents">
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-medium text-muted-foreground">Organization</h2>
            <RegisteredFormField
              name="legalName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Legal name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      required
                      maxLength={200}
                      autoComplete="organization"
                      placeholder="As it should appear on documents"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <RegisteredFormField
                name="pan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PAN</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        required
                        className="font-mono uppercase"
                        maxLength={10}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="ABCDE1234F"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RegisteredFormField
                name="gstin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GSTIN (optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="font-mono uppercase"
                        maxLength={15}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="27ABCDE1234F1Z5"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <RegisteredFormField
              name="addressLine1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address line 1</FormLabel>
                  <FormControl>
                    <Input {...field} required maxLength={200} autoComplete="address-line1" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <RegisteredFormField
              name="addressLine2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address line 2 (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} autoComplete="address-line2" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <RegisteredFormField
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} required maxLength={120} autoComplete="address-level2" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="stateCode"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>State code</FormLabel>
                    <FormControl>
                      <OptionField
                        required
                        options={STATE_OPTIONS}
                        noun="states"
                        showCode
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Choose a state"
                        inputRef={field.ref}
                        aria-invalid={fieldState.invalid}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RegisteredFormField
                name="pinCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PIN code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        required
                        className="font-mono tabular-nums"
                        maxLength={6}
                        inputMode="numeric"
                        pattern="[1-9][0-9]{5}"
                        autoComplete="postal-code"
                        placeholder="400001"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-medium text-muted-foreground">Document numbering</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {PREFIX_FIELDS.map(([name, label]) => (
                <RegisteredFormField
                  key={name}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label} prefix</FormLabel>
                      <FormControl>
                        <Input {...field} maxLength={4} className="font-mono uppercase" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
            <FormField
              control={form.control}
              name="financialYearStart"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Fiscal year starts in</FormLabel>
                  <FormControl>
                    <OptionField
                      options={MONTH_OPTIONS}
                      noun="months"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Choose a month"
                      inputRef={field.ref}
                      aria-invalid={fieldState.invalid}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>
        </fieldset>

        <div>
          <SubmitButton isSubmitting={update.isPending} disabled={!isDirty}>
            Save settings
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
