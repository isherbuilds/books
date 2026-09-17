import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type Ref } from "react";

import { LinkField } from "@/components/link-field";
import { PartySheet } from "@/components/party-form";
import { useCan } from "@/lib/membership";
import { partyListOptions } from "@/lib/parties";

// A form's value is `{ id, name }`; list rows also carry what the picker shows.
type PartyOption = {
  id: string;
  name: string;
  gstin?: string | null;
};

export function PartyLinkField({
  orgSlug,
  value,
  onSelect,
  clearable,
  inputRef,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  orgSlug: string;
  value: PartyOption | null;
  onSelect: (party: PartyOption | null) => void;
  clearable?: boolean;
  /** Usually RHF's `field.ref`, so focus-on-error reaches the picker. */
  inputRef: Ref<HTMLInputElement>;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const parties = useQuery(partyListOptions(orgSlug));
  const activeParties = parties.data?.filter((party) => party.active);
  const canCreate = useCan(orgSlug, { party: ["create"] });
  const [createSeed, setCreateSeed] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  // The field keeps its own handle to refocus after a quick-create and still hands
  // the input to the caller's ref.
  const attachInput = (element: HTMLInputElement | null) => {
    input.current = element;

    if (typeof inputRef === "function") inputRef(element);
    else if (inputRef) inputRef.current = element;
  };

  // A frame later, once the closing Sheet has released focus.
  const closeCreate = () => {
    setCreateOpen(false);
    requestAnimationFrame(() => input.current?.focus());
  };

  return (
    <>
      <LinkField<PartyOption>
        items={activeParties}
        query={parties}
        noun="parties"
        getKey={(party) => party.id}
        getLabel={(party) => party.name}
        getCode={(party) => party.gstin ?? undefined}
        value={value}
        onSelect={onSelect}
        onCreate={
          canCreate
            ? (seed) => {
                setCreateSeed(seed);
                setCreateOpen(true);
              }
            : undefined
        }
        clearable={clearable}
        placeholder={canCreate ? "Select or create a party" : "Select a party"}
        inputRef={attachInput}
        id={id}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
      <PartySheet
        orgSlug={orgSlug}
        open={createOpen}
        seedName={createSeed}
        onClose={closeCreate}
        onSaved={(party) => {
          onSelect(party);
          closeCreate();
        }}
      />
    </>
  );
}
