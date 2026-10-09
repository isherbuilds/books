import { parseRoles } from "@accly/auth/access";

export const readRoles = (role: string) => parseRoles(role);
