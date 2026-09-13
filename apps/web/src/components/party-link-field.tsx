import { INDIAN_STATES } from "@accly/api/lib/indian-states";
import { useQuery } from "@tanstack/react-query";
import { useState, type RefObject } from "react";

import { LinkField } from "@/components/link-field";
import { PartySheet } from "@/components/party-form";
import { useCan } from "@/lib/membership";
import { partyListOptions } from "@/lib/parties";

// A form's value is `{ id, name }`; list rows also carry what the picker shows.
type PartyOption = {
  id: string;
  name: string;
  gstin?: string | null;
  city?: string | null;
  stateCode?: string;
};

export function PartyLinkField({
  orgSlug,
  value,
  onSelect,
  onCommit,
  clearable,
  inputRef,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  orgSlug: string;
  value: PartyOption | null;
  onSelect: (party: PartyOption | null) => void;
  onCommit?: () => void;
  clearable?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const parties = useQuery(partyListOptions(orgSlug));
  const activeParties = parties.data?.filter((party) => party.active);
  const canCreate = useCan(orgSlug, { party: ["create"] });
  const [createSeed, setCreateSeed] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // A frame later, once the closing Sheet has released focus.
  const closeCreate = () => {
    setCreateOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
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
        getDescription={(party) =>
          party.city ?? (party.stateCode ? INDIAN_STATES[party.stateCode] : undefined)
        }
        value={value}
        onSelect={onSelect}
        onCommit={onCommit}
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
        inputRef={inputRef}
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
