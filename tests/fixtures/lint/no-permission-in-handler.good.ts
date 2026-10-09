import { orgProcedure } from "../lib/procedures/factory";

export const read = orgProcedure({ journal: ["read"] }, undefined);
