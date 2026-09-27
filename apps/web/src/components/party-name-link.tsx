import { Link } from "@tanstack/react-router";

/** A record's party name, linked to the party when the viewer may read parties. */
export function PartyNameLink({
  orgSlug,
  partyId,
  name,
  canRead,
}: {
  orgSlug: string;
  partyId: string | null;
  name: string | null | undefined;
  canRead: boolean;
}) {
  if (!partyId || !canRead) return name ?? "No party";

  return (
    <Link
      to="/$orgSlug/parties/$partyId"
      params={{ orgSlug, partyId }}
      className="underline-offset-4 hover:underline"
    >
      {name ?? "Party"}
    </Link>
  );
}
