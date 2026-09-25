import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@accly/ui/components/form";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type Ref } from "react";
import { useFormContext } from "react-hook-form";

import { LinkField } from "@/components/link-field";
import { PartySheet } from "@/components/party-form";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useCan } from "@/lib/membership";
import type { ListState } from "@/lib/list-state";
import { partyPickerOptions, type PartyOption, type PartyPicker } from "@/lib/parties";

/**
 * The owner supplies the cached master and quick-create action. Past the master's
 * bound, typed text searches the server, so every party stays reachable.
 */
export function PartyLinkField({
  orgSlug,
  parties,
  value,
  onSelect,
  onCreate,
  clearable,
  inputRef,
  autoFocus,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  orgSlug: string;
  parties: ListState<PartyPicker>;
  value: PartyOption | null;
  onSelect: (party: PartyOption | null) => void;
  onCreate?: (seed: string) => void;
  clearable?: boolean;
  inputRef: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [needle, setNeedle] = useState("");
  const typed = useDebouncedValue(needle, 200);
  const remote = parties.data?.hasMore === true && needle !== "";

  const search = useQuery({
    ...partyPickerOptions(orgSlug, typed),
    enabled: remote && typed !== "",
    placeholderData: keepPreviousData,
  });

  const source = remote ? search : parties;
  const settled = !remote || (typed === needle && !search.isPlaceholderData);

  return (
    <LinkField<PartyOption>
      items={source.data?.rows}
      query={source}
      noun="parties"
      complete={settled && source.data?.hasMore === false}
      onSearch={setNeedle}
      getKey={(party) => party.id}
      getLabel={(party) => party.name}
      getCode={(party) => party.gstin ?? undefined}
      value={value}
      onSelect={onSelect}
      onCreate={onCreate}
      clearable={clearable}
      placeholder={onCreate ? "Select or create a party" : "Select a party"}
      inputRef={inputRef}
      autoFocus={autoFocus}
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}

type DocumentPartyValues = { partyId: string | null; partyName: string };

/**
 * A document's Party. The form holds `partyId` and the display-only `partyName`; a
 * party typed but not found is created in a stacked Sheet (DocumentForm ignores its
 * portal events) and selected. `onPartyChange` runs only when the party changes.
 */
export function DocumentPartyField({
  orgSlug,
  label,
  clearable,
  onPartyChange,
}: {
  orgSlug: string;
  label: string;
  clearable?: boolean;
  onPartyChange?: (party: PartyOption | null) => void;
}) {
  const form = useFormContext<DocumentPartyValues>();
  const parties = useQuery(partyPickerOptions(orgSlug));
  const canCreate = useCan(orgSlug, { party: ["create"] });
  const [createSeed, setCreateSeed] = useState<string | null>(null);

  const select = (party: PartyOption | null) => {
    const changed = (party?.id ?? null) !== form.getValues("partyId");

    form.setValue("partyId", party?.id ?? null, { shouldDirty: true, shouldValidate: true });
    form.setValue("partyName", party?.name ?? "");

    if (changed) onPartyChange?.(party);
  };

  return (
    <>
      <FormField
        control={form.control}
        name="partyId"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <PartyLinkField
                orgSlug={orgSlug}
                parties={parties}
                value={field.value ? { id: field.value, name: form.getValues("partyName") } : null}
                onSelect={select}
                onCreate={canCreate ? setCreateSeed : undefined}
                clearable={clearable}
                inputRef={field.ref}
                autoFocus={form.formState.submitCount > 0}
                aria-invalid={fieldState.invalid}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <PartySheet
        orgSlug={orgSlug}
        open={createSeed !== null}
        seedName={createSeed ?? ""}
        onClose={() => setCreateSeed(null)}
        onSaved={(party) => {
          select(party);
          setCreateSeed(null);
        }}
      />
    </>
  );
}
