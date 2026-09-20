import type { UseQueryResult } from "@tanstack/react-query";
import type { Ref } from "react";

import { LinkField } from "@/components/link-field";
import type { PartyOption } from "@/lib/parties";

/** The owner supplies the party query and quick-create action. */
export function PartyLinkField({
  parties,
  value,
  onSelect,
  onCreate,
  clearable,
  inputRef,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  parties: UseQueryResult<PartyOption[]>;
  value: PartyOption | null;
  onSelect: (party: PartyOption | null) => void;
  onCreate?: (seed: string) => void;
  clearable?: boolean;
  inputRef: Ref<HTMLInputElement>;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  return (
    <LinkField<PartyOption>
      items={parties.data}
      query={parties}
      noun="parties"
      getKey={(party) => party.id}
      getLabel={(party) => party.name}
      getCode={(party) => party.gstin ?? undefined}
      value={value}
      onSelect={onSelect}
      onCreate={onCreate}
      clearable={clearable}
      placeholder={onCreate ? "Select or create a party" : "Select a party"}
      inputRef={inputRef}
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}
