import {
  documentPrefix,
  pan,
  optionalGstin,
  indianStateCode,
  indianPinCode,
  validateGstinIdentity,
  timeZone,
} from "@accly/api/lib/schemas";
import { INDIAN_STATES } from "@accly/api/lib/indian-states";
import type { SettingsFields } from "@accly/api/routers/settings";
import {
  Form,
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { NativeSelect } from "@accly/ui/components/native-select";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useFormState } from "react-hook-form";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

export const Route = createFileRoute("/$orgSlug/settings/organization")({
  head: () => ({ meta: [{ title: "Organization · Accly Books" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    // The page is a save form, so the tab strip gates it on `update` too.
    await requireOrgPermission(queryClient, orgSlug, { settings: ["update"] });
    await queryClient.query(orpc.settings.get.queryOptions({ input: { orgSlug } })).catch(() => {});
  },
  component: SettingsRoute,
});

const supportedTimeZones = Intl.supportedValuesOf("timeZone");

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
    timeZone,
    invoicePrefix: documentPrefix,
    receiptPrefix: documentPrefix,
    paymentPrefix: documentPrefix,
    creditNotePrefix: documentPrefix,
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

const MONTHS = [
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
] as const;

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

  const update = useMutation(
    orpc.settings.update.mutationOptions({
      onSuccess: async (saved) => {
        form.reset(toFormValues(saved));
        toast.success("Settings saved");
        // Awaited: `member.me` carries the time zone every page formats with, and the org
        // layout loader holds it, so open pages would keep the old zone until staleTime lapses.
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.settings.get.key({ input: { orgSlug } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.member.me.key({ input: { orgSlug } }),
          }),
        ]);
        await router.invalidate();
      },
      onError: (error) => toast.error(errorMessage(error, "Could not save the settings")),
    }),
  );

  const onSubmit = form.handleSubmit((values) => update.mutate({ orgSlug, ...values }));

  return (
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
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
              <RegisteredFormField
                name="stateCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State code</FormLabel>
                    <FormControl>
                      <NativeSelect {...field} required className="text-xs">
                        {Object.entries(INDIAN_STATES).map(([code, name]) => (
                          <option key={code} value={code}>
                            {code} — {name}
                          </option>
                        ))}
                      </NativeSelect>
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
                        className="font-mono"
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
            <RegisteredFormField
              name="timeZone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Time zone</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {/* Keep a stored zone selectable even when this browser's canonical list omits it. */}
                      {defaults.timeZone && !supportedTimeZones.includes(defaults.timeZone) ? (
                        <option value={defaults.timeZone}>{defaults.timeZone}</option>
                      ) : null}
                      {supportedTimeZones.map((timeZone) => (
                        <option key={timeZone} value={timeZone}>
                          {timeZone}
                        </option>
                      ))}
                    </NativeSelect>
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
              <RegisteredFormField
                name="invoicePrefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice prefix</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={4} className="uppercase" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RegisteredFormField
                name="receiptPrefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Receipt prefix</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={4} className="uppercase" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RegisteredFormField
                name="paymentPrefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment prefix</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={4} className="uppercase" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RegisteredFormField
                name="creditNotePrefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Credit note prefix</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={4} className="uppercase" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <RegisteredFormField
              name="financialYearStart"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fiscal year starts in</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {MONTHS.map((month, index) => (
                        <option key={month} value={index + 1}>
                          {month}
                        </option>
                      ))}
                    </NativeSelect>
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
