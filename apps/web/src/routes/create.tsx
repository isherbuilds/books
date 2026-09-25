import {
  deriveOrganizationIdentity,
  gstinParts,
  optionalGstin,
  optionalPan,
  optionalStateCode,
  indianPinCode,
} from "@accly/api/lib/schemas";
import { ORGANIZATION_SLUG_MIN_LENGTH, organizationSlugIssue } from "@accly/auth/organization-slug";
import {
  Form,
  FormControl,
  FormDescription,
  FormFieldset,
  FormItem,
  FormLabel,
  FormMessage,
  FormField,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useRef } from "react";
import { Watch, useFormContext, useFormState, useWatch } from "react-hook-form";
import { z } from "zod";

import { MONTH_OPTIONS, OptionField, STATE_OPTIONS, type Option } from "@/components/option-field";
import { OrganizationEntryLayout } from "@/components/organization-entry-layout";
import { ErrorNote } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { errorMessage } from "@/lib/orpc-error";

export const Route = createFileRoute("/create")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();

    if (!session.data) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: CreateOrganizationRoute,
});

function slugFrom(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const LEGAL_TYPES = [
  "individual",
  "proprietorship",
  "partnership",
  "llp",
  "company",
  "trust",
  "society",
] as const;

const LEGAL_TYPE_LABELS: Record<(typeof LEGAL_TYPES)[number], string> = {
  individual: "Individual",
  proprietorship: "Proprietorship",
  partnership: "Partnership",
  llp: "Limited liability partnership (LLP)",
  company: "Company",
  trust: "Trust",
  society: "Society",
};

const LEGAL_TYPE_OPTIONS: Option[] = LEGAL_TYPES.map((code) => ({
  code,
  name: LEGAL_TYPE_LABELS[code],
}));

const optionalTrimmedString = z
  .string()
  .trim()
  .max(200, "Enter no more than 200 characters")
  .transform((value) => value || undefined);

const createOrganizationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter an organization name")
      .max(120, "Enter no more than 120 characters"),
    slug: z
      .string()
      .transform(slugFrom)
      .superRefine((slug, context) => {
        const message = organizationSlugIssue(slug);

        if (message) context.addIssue({ code: "custom", message });
      }),
    legalType: z
      .union([z.literal(""), z.enum(LEGAL_TYPES)])
      .pipe(z.enum(LEGAL_TYPES, { error: "Select a legal type" })),
    legalName: z
      .string()
      .trim()
      .min(1, "Enter the legal name")
      .max(200, "Enter no more than 200 characters"),
    pan: optionalPan,
    gstin: optionalGstin.unwrap(),
    stateCode: optionalStateCode,
    // Asked here because it names every number series and locks at the first one.
    financialYearStart: z
      .string()
      .refine((raw) => raw.trim() !== "", "Pick a month")
      .transform(Number)
      .pipe(z.number().int().min(1, "Pick a month").max(12, "Pick a month")),
    addressLine1: z
      .string()
      .trim()
      .min(1, "Enter the registered address")
      .max(200, "Enter no more than 200 characters"),
    addressLine2: optionalTrimmedString,
    city: z.string().trim().min(1, "Enter the city").max(120, "Enter no more than 120 characters"),
    pinCode: indianPinCode,
  })
  .transform(deriveOrganizationIdentity);

function CreateOrganizationRoute() {
  return (
    <OrganizationEntryLayout
      eyebrow="CREATE ORGANIZATION"
      title="Bring this organization into Accly Books."
      description="The address names the organization in every tab and shared link. Data and permissions stay isolated behind it."
      aside={
        <p>
          Have an invitation?{" "}
          <Link to="/join" className="text-foreground underline underline-offset-4">
            Join an organization
          </Link>
        </p>
      }
    >
      <CreateOrganizationForm />
    </OrganizationEntryLayout>
  );
}

function CreateOrganizationForm() {
  const navigate = useNavigate();
  const slugEdited = useRef(false);
  const legalNameEdited = useRef(false);

  const form = useZodForm(createOrganizationSchema, {
    defaultValues: {
      name: "",
      slug: "",
      legalType: "",
      legalName: "",
      pan: "",
      gstin: "",
      stateCode: "",
      financialYearStart: "4",
      addressLine1: "",
      addressLine2: "",
      city: "",
      pinCode: "",
    },
  });

  // The server derives State and PAN from a GSTIN, so they show only without one.
  const gstin = useWatch({ control: form.control, name: "gstin" });

  const create = useMutation(
    orpc.organization.create.mutationOptions({
      onSuccess: async (organization) => {
        await navigate({
          to: "/$orgSlug/onboarding",
          params: { orgSlug: organization.slug },
        });
      },
      onError: (error) => {
        form.setError("root.server", {
          message: errorMessage(error, "This organization could not be created."),
        });
      },
    }),
  );

  const submit = form.handleSubmit((values) => {
    form.clearErrors("root.server");
    create.mutate(values);
  });

  return (
    <Form {...form}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Organization details</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            Creation is restricted to the deployment&apos;s founding operator.
          </p>
        </div>

        <FormFieldset disabled={create.isPending} className="flex flex-col gap-4">
          <section className="flex flex-col gap-3" aria-labelledby="organization-identity">
            <h3 id="organization-identity" className="text-xs font-medium text-muted-foreground">
              Legal identity
            </h3>
            <OrganizationNameField
              onNameChange={(name) => {
                if (!slugEdited.current) form.setValue("slug", slugFrom(name));

                if (!legalNameEdited.current) form.setValue("legalName", name);
              }}
            />
            <RegisteredFormField
              name="legalName"
              rules={{
                onChange: () => {
                  legalNameEdited.current = true;
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Legal name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      required
                      maxLength={200}
                      autoComplete="organization"
                      placeholder="Name on legal records"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="legalType"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Legal type</FormLabel>
                    <FormControl>
                      <OptionField
                        required
                        options={LEGAL_TYPE_OPTIONS}
                        noun="legal types"
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Choose legal type"
                        inputRef={field.ref}
                        aria-invalid={fieldState.invalid}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="financialYearStart"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Fiscal year starts in</FormLabel>
                    <FormControl>
                      <OptionField
                        required
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
            </div>
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
                        placeholder="22ABCDE1234F1Z5"
                        onChange={(event) => {
                          void field.onChange(event);
                          const parts = gstinParts(event.currentTarget.value);

                          if (!parts) return;

                          form.setValue("stateCode", parts.stateCode);
                          form.setValue("pan", parts.pan);
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
            <OrganizationSlugField
              onSlugEdit={() => {
                slugEdited.current = true;
              }}
            />
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="registered-address">
            <h3 id="registered-address" className="text-xs font-medium text-muted-foreground">
              Registered address
            </h3>
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
            <div className="grid gap-3 sm:grid-cols-2">
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
                          placeholder="Choose state or union territory"
                          inputRef={field.ref}
                          aria-invalid={fieldState.invalid}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </div>
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
          </section>

          <CreateError />
          <SubmitButton isSubmitting={create.isPending} className="w-full">
            Create organization
            <ArrowRightIcon data-icon="inline-end" />
          </SubmitButton>
        </FormFieldset>
      </form>
    </Form>
  );
}

function OrganizationNameField({ onNameChange }: { onNameChange: (name: string) => void }) {
  return (
    <RegisteredFormField
      name="name"
      rules={{ onChange: (event) => onNameChange(event.target.value) }}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Organization name</FormLabel>
          <FormControl>
            <Input
              {...field}
              autoFocus
              required
              maxLength={120}
              placeholder="Meridian Traders"
              autoComplete="organization"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function OrganizationSlugField({ onSlugEdit }: { onSlugEdit: () => void }) {
  const { control, setValue } = useFormContext();

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
      <RegisteredFormField
        name="slug"
        rules={{
          onChange: onSlugEdit,
          // Normalised on blur, not per keystroke, so the caret never jumps.
          onBlur: (event) => setValue("slug", slugFrom(event.target.value)),
        }}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs tracking-widest text-muted-foreground">
              ORGANIZATION ADDRESS
            </FormLabel>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
                /
              </span>
              <FormControl>
                <Input
                  {...field}
                  required
                  className="h-7 font-mono"
                  placeholder="meridian-traders"
                  autoComplete="off"
                  spellCheck={false}
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <Watch
        control={control}
        name="slug"
        exact
        render={(value) => (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            Saved as /{slugFrom(String(value ?? "")) || "meridian-traders"} — at least{" "}
            {ORGANIZATION_SLUG_MIN_LENGTH} characters, and permanent.
          </p>
        )}
      />
    </div>
  );
}

function CreateError() {
  const { control } = useFormContext();
  const { errors } = useFormState({ control });
  const message = errors.root?.server?.message;

  return message ? <ErrorNote title={message} /> : null;
}
