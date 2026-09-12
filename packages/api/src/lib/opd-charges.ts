import { db } from "@accly/db";
import { items, OPD_BILLABLE_CATEGORIES } from "@accly/db/schema/items";
import { departments } from "@accly/db/schema/departments";
import { opdAppointments } from "@accly/db/schema/opd-appointments";
import { customers } from "@accly/db/schema/customers";
import { practitioners } from "@accly/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, eq, gte, inArray } from "drizzle-orm";

const DAY_MS = 86_400_000;

type OpdItemSnapshot = Pick<
  typeof items.$inferSelect,
  "id" | "name" | "category" | "unitPrice" | "taxRatePercent" | "taxCode"
>;

export async function resolveOpdPricing(options: {
  orgId: string;
  practitionerId: string;
  customerId: string | null;
  services: readonly { itemId: string; qty: number }[];
  consultation: "auto" | "omit" | "none";
  followUpValidityDays: number;
  now: Date;
}) {
  const { orgId, customerId } = options;

  const [careTeam] = await db
    .select({
      id: practitioners.id,
      departmentId: practitioners.departmentId,
      consultFeeItemId: practitioners.consultFeeItemId,
      followUpFeeItemId: practitioners.followUpFeeItemId,
      followUpValidityDays: practitioners.followUpValidityDays,
      defaultConsultFeeItemId: departments.defaultConsultFeeItemId,
    })
    .from(practitioners)
    .innerJoin(
      departments,
      and(eq(departments.orgId, orgId), eq(departments.id, practitioners.departmentId)),
    )
    .where(and(eq(practitioners.orgId, orgId), eq(practitioners.id, options.practitionerId)))
    .limit(1);

  if (!careTeam) {
    throw new ORPCError("NOT_FOUND", { message: "That practitioner no longer exists." });
  }

  const serviceIds = options.services.map((service) => service.itemId);

  const feeIds =
    options.consultation === "auto"
      ? [
          careTeam.followUpFeeItemId,
          careTeam.consultFeeItemId,
          careTeam.defaultConsultFeeItemId,
        ].filter((id): id is string => id != null)
      : [];

  const itemIds = [...new Set([...feeIds, ...serviceIds])];
  const followUpDays = careTeam.followUpValidityDays ?? options.followUpValidityDays;

  const [customerRows, recentRows, itemRows] = await Promise.all([
    customerId
      ? db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.orgId, orgId), eq(customers.id, customerId)))
          .limit(1)
      : Promise.resolve([]),
    options.consultation === "auto" && careTeam.followUpFeeItemId != null && customerId != null
      ? db
          .select({ id: opdAppointments.id })
          .from(opdAppointments)
          .where(
            and(
              eq(opdAppointments.orgId, orgId),
              eq(opdAppointments.customerId, customerId),
              eq(opdAppointments.practitionerId, careTeam.id),
              eq(opdAppointments.status, "checked_in"),
              gte(
                opdAppointments.arrivedAt,
                new Date(options.now.getTime() - followUpDays * DAY_MS),
              ),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    itemIds.length > 0
      ? db
          .select({
            id: items.id,
            name: items.name,
            category: items.category,
            unitPrice: items.unitPrice,
            taxRatePercent: items.taxRatePercent,
            taxCode: items.taxCode,
          })
          .from(items)
          .where(and(eq(items.orgId, orgId), eq(items.active, true), inArray(items.id, itemIds)))
      : Promise.resolve([]),
  ]);

  if (customerId != null && !customerRows[0]) {
    throw new ORPCError("NOT_FOUND", { message: "That customer no longer exists." });
  }

  const itemsById: Record<string, OpdItemSnapshot> = Object.fromEntries(
    itemRows.map((item) => [item.id, item]),
  );

  const feeItem =
    options.consultation === "auto"
      ? ((recentRows[0] && careTeam.followUpFeeItemId
          ? itemsById[careTeam.followUpFeeItemId]
          : undefined) ??
        (careTeam.consultFeeItemId ? itemsById[careTeam.consultFeeItemId] : undefined) ??
        (careTeam.defaultConsultFeeItemId
          ? itemsById[careTeam.defaultConsultFeeItemId]
          : undefined))
      : undefined;

  const serviceItems = options.services.map((service) => {
    const item = itemsById[service.itemId];
    const billable = item && OPD_BILLABLE_CATEGORIES.some((category) => category === item.category);

    if (
      !item ||
      !billable ||
      (options.consultation === "none" && item.category === "consultation")
    ) {
      throw new ORPCError("NOT_FOUND", { message: "That service is no longer available." });
    }

    return { item, qty: service.qty };
  });

  return { departmentId: careTeam.departmentId, feeItem, serviceItems };
}

export function chargeRow(args: {
  orgId: string;
  appointmentId: string;
  item: OpdItemSnapshot;
  qty: number;
  sourceType: "consult_fee" | "item";
  userId: string;
  now: Date;
}) {
  return {
    id: Bun.randomUUIDv7(),
    orgId: args.orgId,
    opdAppointmentId: args.appointmentId,
    itemId: args.item.id,
    description: args.item.name,
    qty: args.qty,
    unitPrice: args.item.unitPrice,
    taxRatePercent: args.item.taxRatePercent,
    taxCode: args.item.taxCode,
    revenueCategory: args.item.category,
    sourceType: args.sourceType,
    sourceId: null,
    status: "pending",
    createdBy: args.userId,
    createdAt: args.now,
    updatedAt: args.now,
  } as const;
}
