import { requirePermission } from "../lib/procedures/factory";

export function settle(scope: Parameters<typeof requirePermission>[0]) {
  requirePermission(scope, { journal: ["read"] });
}
