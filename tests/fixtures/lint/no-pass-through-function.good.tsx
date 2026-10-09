import { parseRoles } from "@accly/auth/access";

export const roles = ["owner"].map((role) => parseRoles(role));
export const handlers = { onRole: (role: string) => parseRoles(role) };
export const load = async (role: string) => parseRoles(role);

export function Picker({ pick }: { pick: (value: string) => void }) {
  return <select onChange={(event) => pick(event.target.value)} />;
}
