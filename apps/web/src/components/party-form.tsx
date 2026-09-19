// Copyright (c) Midday Labs AB, AGPL-3.0, from midday-ai/midday@51587319f26a0ffaa9dfccab1920373cb65689b7
// Adapted from apps/dashboard/src/components/forms/customer-form.tsx and sheets/customer-edit-sheet.tsx.
import { INDIAN_STATES } from "@accly/api/lib/indian-states";
import {
  GSTIN_PATTERN,
  indianPinCode,
  indianStateCode,
  optionalGstin,
  optionalPan,
  validateGstinIdentity,
} from "@accly/api/lib/schemas";
import type { PartyRecord } from "@accly/api/routers/party";
import { Button } from "@accly/ui/components/button";
import { Checkbox } from "@accly/ui/components/checkbox";
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
import { NativeSelect } from "@accly/ui/components/native-select";
import { Separator } from "@accly/ui/components/separator";
import { SheetBody, SheetFooter } from "@accly/ui/components/sheet";
import { SubmitButton } from "@accly/ui/components/submit-button";
import { ToggleGroup, ToggleGroupItem } from "@accly/ui/components/toggle-group";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { useFormState } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { FormSheet } from "@/components/form-sheet";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidatePartyState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage, errorReason } from "@/lib/orpc-error";
import { PARTY_ROLES, ROLE_LABELS, partyListOptions } from "@/lib/parties";

// The server refuses "", so a blank optional field is sent as absent.
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || undefined);

const partyFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a party name")
      .max(120, "Keep the name under 120 characters"),
    roles: z.array(z.enum(PARTY_ROLES)).min(1, "Choose at least one role"),
    phone: optionalText(30, "Keep the phone number under 30 characters"),
    email: z
      .string()
      .trim()
      .refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email")
      .transform((value) => value || undefined),
    gstin: optionalGstin,
    stateCode: indianStateCode,
    pan: optionalPan,
    addressLine1: optionalText(200, "Keep the address line under 200 characters"),
    addressLine2: optionalText(200, "Keep the address line under 200 characters"),
    city: optionalText(120, "Keep the city under 120 characters"),
    pinCode: z.union([z.literal(""), indianPinCode]).transform((value) => value || undefined),
    active: z.boolean(),
  })
  .superRefine(validateGstinIdentity);

type SavedParty = { id: string; name: string };

function defaultValues(party: PartyRecord | undefined, seedName: string | undefined) {
  return {
    name: party?.name ?? seedName ?? "",
    roles: party?.roles ?? ["customer" as const],
    phone: party?.phone ?? "",
    email: party?.email ?? "",
    gstin: party?.gstin ?? "",
    stateCode: party?.stateCode ?? "",
    pan: party?.pan ?? "",
    addressLine1: party?.addressLine1 ?? "",
    addressLine2: party?.addressLine2 ?? "",
    city: party?.city ?? "",
    pinCode: party?.pinCode ?? "",
    active: party?.active ?? true,
  };
}

/** A flat Sheet section: muted heading, no card. Sections are split by `Separator`. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();

  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 id={id} className="text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function TextField({
  name,
  label,
  ...inputProps
}: {
  name: "pan" | "phone" | "email" | "addressLine1" | "addressLine2" | "city" | "pinCode";
  label: string;
} & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <RegisteredFormField
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input {...inputProps} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * Create (no `party`) or edit (`party`, sent back with its `updatedAt` token).
 * Focus starts on Name, or on GSTIN when the name was seeded by a Link Field.
 */
function PartyForm({
  orgSlug,
  party,
  seedName,
  onSaved,
  onCancel,
}: {
  orgSlug: string;
  party?: PartyRecord;
  seedName?: string;
  onSaved: (party: SavedParty) => void;
  /** Also runs when the server refuses a stale edit, so the caller shows the fresh row. */
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [nameCollision, setNameCollision] = useState<string | null>(null);
  const form = useZodForm(partyFormSchema, { defaultValues: defaultValues(party, seedName) });
  // The copy the form opened from: a background refetch of the record must not swap
  // the token under an unsaved draft, or Save would overwrite a newer row unchecked.
  const [editToken] = useState(() => party?.updatedAt.toISOString() ?? "");
  const { isDirty } = useFormState({ control: form.control });
  const listKey = partyListOptions(orgSlug).queryKey;

  // The server returns the saved row: write it into both caches so the list and the
  // record show it now, and the next edit carries the new `updatedAt` token. The list
  // keeps only its own fields. Its refresh runs in the background instead of making
  // Save wait for up to 5,000 rows.
  const saved = (row: PartyRecord) => {
    const { id, name, roles, gstin, active } = row;

    queryClient.setQueryData(listKey, (rows) =>
      rows
        ? [...rows.filter((each) => each.id !== id), { id, name, roles, gstin, active }].sort(
            (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
          )
        : rows,
    );
    queryClient.setQueryData(orpc.party.get.queryKey({ input: { orgSlug, partyId: row.id } }), row);
    void queryClient.invalidateQueries({ queryKey: listKey });
    onSaved({ id: row.id, name: row.name });
  };

  const failed = (error: unknown) => {
    const reason = errorReason(error);

    if (reason === "PARTY_NAME_COLLISION") {
      setNameCollision(form.getValues("name").trim());

      return;
    }

    // The editor held an old copy: refresh the record and the list, and leave the form.
    if (reason === "STALE_RECORD") {
      void invalidatePartyState(queryClient, orgSlug);
      toast.error(errorMessage(error, "Could not save the party"));
      onCancel();

      return;
    }

    applyOrpcFieldError(form, error, { PARTY_GSTIN_TAKEN: "gstin" }, "Could not save the party");
  };

  const create = useMutation(
    orpc.party.create.mutationOptions({ onSuccess: saved, onError: failed }),
  );

  const update = useMutation(
    orpc.party.update.mutationOptions({ onSuccess: saved, onError: failed }),
  );

  const pending = create.isPending || update.isPending;
  const canSubmit = !party || isDirty;

  const submit = (values: z.output<typeof partyFormSchema>, allowNamesake: boolean) => {
    setNameCollision(null);

    const { active, ...fields } = values;

    if (party) {
      update.mutate({
        orgSlug,
        partyId: party.id,
        ...fields,
        active,
        allowNamesake,
        updatedAt: editToken,
      });
    } else {
      create.mutate({ orgSlug, ...fields, allowNamesake });
    }
  };

  const onSubmit = form.handleSubmit((values) => submit(values, false));
  const saveAnyway = form.handleSubmit((values) => submit(values, true));

  // A GSTIN carries the state code and the PAN; fill whichever is still empty.
  const fillFromGstin = (value: string) => {
    const gstin = value.trim().toUpperCase();

    if (!GSTIN_PATTERN.test(gstin)) return;

    const stateCode = gstin.slice(0, 2);

    if (!form.getValues("stateCode") && Object.hasOwn(INDIAN_STATES, stateCode)) {
      form.setValue("stateCode", stateCode, { shouldDirty: true });
    }

    if (!form.getValues("pan")) form.setValue("pan", gstin.slice(2, 12), { shouldDirty: true });
  };

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={onSubmit}
        // Handled even while clean or saving, so the key never reaches the receipt
        // form this Sheet may sit over.
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.key !== "Enter" ||
            !(event.metaKey || event.ctrlKey)
          ) {
            return;
          }

          event.preventDefault();

          if (canSubmit && !pending) void onSubmit();
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <fieldset disabled={pending} className="contents">
          <SheetBody>
            <Section title="General">
              <RegisteredFormField
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        required
                        autoFocus={!seedName}
                        autoComplete="organization"
                        onChange={(event) => {
                          void field.onChange(event);
                          setNameCollision(null);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="roles"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Roles</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        multiple
                        value={field.value}
                        onValueChange={field.onChange}
                        variant="outline"
                        size="sm"
                        spacing={1}
                        aria-label="Party roles"
                        className="flex-wrap"
                      >
                        {PARTY_ROLES.map((role) => (
                          <ToggleGroupItem key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  name="phone"
                  label="Phone"
                  type="tel"
                  maxLength={30}
                  autoComplete="tel"
                />
                <TextField
                  name="email"
                  label="Email"
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                />
              </div>
            </Section>

            <Separator />

            <Section title="Tax">
              <div className="grid gap-3 sm:grid-cols-2">
                <RegisteredFormField
                  name="gstin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GSTIN</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoFocus={Boolean(seedName)}
                          className="font-mono uppercase"
                          maxLength={15}
                          autoCapitalize="characters"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => {
                            void field.onChange(event);
                            fillFromGstin(event.currentTarget.value);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <RegisteredFormField
                  name="stateCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} required>
                          <option value="">Choose state</option>
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
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  name="pan"
                  label="PAN"
                  className="font-mono uppercase"
                  maxLength={10}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </Section>

            <Separator />

            <Section title="Address">
              <TextField
                name="addressLine1"
                label="Address line 1"
                maxLength={200}
                autoComplete="address-line1"
              />
              <TextField
                name="addressLine2"
                label="Address line 2"
                maxLength={200}
                autoComplete="address-line2"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="city" label="City" maxLength={120} autoComplete="address-level2" />
                <TextField
                  name="pinCode"
                  label="PIN code"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="postal-code"
                  className="font-mono"
                />
              </div>
            </Section>

            {party ? (
              <>
                <Separator />
                <Section title="Status">
                  <FormField
                    control={form.control}
                    name="active"
                    render={({ field }) => (
                      <FormItem className="grid-cols-[auto_1fr] items-start gap-x-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div className="grid gap-1">
                          <FormLabel>Active</FormLabel>
                          <FormDescription>
                            Inactive parties stay on posted documents and leave the pickers.
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                </Section>
              </>
            ) : null}

            {nameCollision ? (
              <div role="alert" className="flex items-center justify-between gap-3">
                <span>A party named {nameCollision} exists</span>
                <Button type="button" size="xs" variant="outline" onClick={saveAnyway}>
                  {party ? "Save anyway" : "Create anyway"}
                </Button>
              </div>
            ) : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={pending} disabled={!canSubmit}>
              {party ? "Save" : "Create party"}
            </SubmitButton>
          </SheetFooter>
        </fieldset>
      </form>
    </Form>
  );
}

/**
 * The one Party panel: create from the parties list or a Party Link Field, edit from
 * the party page (pass `party`).
 */
export function PartySheet({
  orgSlug,
  open,
  party,
  seedName,
  onClose,
  onSaved,
}: {
  orgSlug: string;
  open: boolean;
  party?: PartyRecord;
  seedName?: string;
  onClose: () => void;
  onSaved: (party: SavedParty) => void;
}) {
  // Stay open while a save is in flight, so a refusal lands on a mounted form.
  const saving =
    useIsMutating({
      mutationKey: party ? orpc.party.update.mutationKey() : orpc.party.create.mutationKey(),
    }) > 0;

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      saving={saving}
      title={party ? "Edit party" : "New party"}
      description={party ? party.name : "Register a customer, vendor, or other counterparty."}
    >
      <PartyForm
        orgSlug={orgSlug}
        party={party}
        seedName={seedName}
        onSaved={onSaved}
        onCancel={onClose}
      />
    </FormSheet>
  );
}
