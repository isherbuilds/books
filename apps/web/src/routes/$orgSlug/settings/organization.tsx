import {
  deriveOrganizationIdentity,
  documentPrefix,
  gstinParts,
  optionalGstin,
  optionalPan,
  optionalStateCode,
  indianPinCode,
  timeZone,
} from "@accly/api/lib/schemas";
import type { SettingsFields } from "@accly/api/routers/settings";
import {
  Form,
  FormControl,
  FormDescription,
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
import { useFormState, useWatch } from "react-hook-form";
import { z } from "zod";

import { MONTH_OPTIONS, OptionField, STATE_OPTIONS, type Option } from "@/components/option-field";
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

const TIME_ZONE_OPTIONS: Option[] = Intl.supportedValuesOf("timeZone").map((code) => ({
  code,
  name: code,
}));

const formSchema = z
  .object({
    legalName: z
      .string()
      .trim()
      .min(1, "Enter the legal name")
      .max(200, "Keep the legal name under 200 characters"),
    pan: optionalPan,
    gstin: optionalGstin.unwrap(),
    stateCode: optionalStateCode,
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
    timeZone,
    invoicePrefix: documentPrefix,
    billPrefix: documentPrefix,
    receiptPrefix: documentPrefix,
    paymentPrefix: documentPrefix,
    creditNotePrefix: documentPrefix,
    debitNotePrefix: documentPrefix,
    journalPrefix: documentPrefix,
  })
  .transform(deriveOrganizationIdentity);

function toFormValues(settings: SettingsFields) {
  return {
    ...settings,
    gstin: settings.gstin ?? "",
    addressLine2: settings.addressLine2 ?? "",
    financialYearStart: String(settings.financialYearStart),
  };
}

function SettingsRoute() {
  const { orgSlug } = Route.useParams();
  const settings = useQuery(orpc.settings.get.queryOptions({ input: { orgSlug } }));

  return (
    <>
      <PageHeader
        title="Organization"
        description="Legal identity, time zone, and document numbering for this organization"
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
  // The server derives State and PAN from a GSTIN, so they show only without one.
  const gstin = useWatch({ control: form.control, name: "gstin" });

  // Keep a stored zone selectable even when this browser's canonical list omits it.
  const timeZoneOptions =
    defaults.timeZone && !TIME_ZONE_OPTIONS.some((option) => option.code === defaults.timeZone)
      ? [{ code: defaults.timeZone, name: defaults.timeZone }, ...TIME_ZONE_OPTIONS]
      : TIME_ZONE_OPTIONS;

  const update = useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: async (saved) => {
        form.reset(toFormValues(saved));
        toast.success("Settings saved");
        // Awaited: the org layout loader holds `member.me`, so open pages would keep
        // the old time zone until staleTime lapses.
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
                        onChange={(event) => {
                          void field.onChange(event);
                          const parts = gstinParts(event.currentTarget.value);

                          if (!parts) return;

                          form.setValue("stateCode", parts.stateCode, { shouldDirty: true });
                          form.setValue("pan", parts.pan, { shouldDirty: true });
                        }}
                      />
                    </FormControl>
                    <FormDescription>State and PAN come from the GSTIN.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {gstin.trim() === "" ? (
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
              ) : null}
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
              {gstin.trim() === "" ? (
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
                          value={field.value ?? ""}
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
              ) : null}
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
            <FormField
              control={form.control}
              name="timeZone"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Time zone</FormLabel>
                  <FormControl>
                    <OptionField
                      options={timeZoneOptions}
                      noun="time zones"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Choose a time zone"
                      inputRef={field.ref}
                      aria-invalid={fieldState.invalid}
                    />
                  </FormControl>
                  <FormDescription>
                    Sets the local date used for numbering and reports. Changing it applies to new
                    records; existing ones keep their date.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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
