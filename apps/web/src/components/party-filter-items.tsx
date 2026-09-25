import { DropdownMenuCheckboxItem, DropdownMenuItem } from "@accly/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";

import { partyListOptions } from "@/lib/parties";

/** One checkable item per party, for a register's party filter. */
export function PartyFilterItems({
  orgSlug,
  partyId,
  onChange,
}: {
  orgSlug: string;
  partyId: string | undefined;
  onChange: (partyId: string | undefined) => void;
}) {
  const parties = useQuery(partyListOptions(orgSlug));

  if (!parties.data?.length)
    return (
      <DropdownMenuItem disabled>
        {parties.isPending ? "Loading…" : parties.isError ? "Could not load parties" : "No parties"}
      </DropdownMenuItem>
    );

  return parties.data.map((party) => (
    <DropdownMenuCheckboxItem
      key={party.id}
      checked={party.id === partyId}
      onCheckedChange={(checked) => onChange(checked ? party.id : undefined)}
    >
      {party.name}
    </DropdownMenuCheckboxItem>
  ));
}
