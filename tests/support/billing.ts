import { computeInvoiceLines } from "@accly/api/lib/invoice-math";
import type { AppRouterClient } from "@accly/api/routers/index";
import { db } from "@accly/db";
import { items } from "@accly/db/schema/items";
import { charges } from "@accly/db/schema/charges";
import { opdAppointments } from "@accly/db/schema/opd-appointments";
import { and, eq, sql } from "drizzle-orm";

export async function addPendingItemCharge({
  orgId,
  userId,
  appointmentId,
  itemId,
  qty = 1,
  id = Bun.randomUUIDv7(),
  createdAt,
}: {
  orgId: string;
  userId: string;
  appointmentId: string;
  itemId: string;
  qty?: number;
  id?: string;
  createdAt?: Date;
}) {
  return db.transaction(async (tx) => {
    const [appointment] = await tx
      .select({ id: opdAppointments.id })
      .from(opdAppointments)
      .where(and(eq(opdAppointments.orgId, orgId), eq(opdAppointments.id, appointmentId)))
      .limit(1)
      .for("update");
    const [item] = await tx
      .select()
      .from(items)
      .where(and(eq(items.orgId, orgId), eq(items.id, itemId)))
      .limit(1);
    if (!appointment || !item) throw new Error("Test charge fixture is incomplete");

    const [charge] = await tx
      .insert(charges)
      .values({
        id,
        orgId,
        opdAppointmentId: appointment.id,
        itemId: item.id,
        description: item.name,
        qty,
        unitPrice: item.unitPrice,
        taxRatePercent: item.taxRatePercent,
        taxCode: item.taxCode,
        revenueCategory: item.category,
        sourceType: "item",
        sourceId: null,
        status: "pending",
        createdBy: userId,
        createdAt,
      })
      .returning();
    if (!charge) throw new Error("Test charge was not inserted");

    await tx
      .update(opdAppointments)
      .set({ chargeRevision: sql`${opdAppointments.chargeRevision} + 1` })
      .where(and(eq(opdAppointments.orgId, orgId), eq(opdAppointments.id, appointment.id)));
    return charge;
  });
}

export async function settlePendingCharges(
  api: AppRouterClient,
  input: {
    orgSlug: string;
    appointmentId: string;
    discountAmount?: string;
    note?: string;
    payments?: Array<{
      method: "cash" | "upi" | "card";
      amount: string;
      reference?: string;
    }>;
  },
) {
  const review = await api.opd.get({
    orgSlug: input.orgSlug,
    appointmentId: input.appointmentId,
  });
  const discountAmount = input.discountAmount ?? "0";
  const pending = review.charges.filter((charge) => charge.status === "pending");
  const quote = computeInvoiceLines(
    pending.map((charge) => ({
      chargeId: charge.id,
      description: charge.description,
      qty: charge.qty,
      unitPrice: charge.unitPrice,
      taxRatePercent: charge.taxRatePercent,
      taxCode: charge.taxCode,
    })),
    discountAmount,
  );

  return api.billing.settleCharges({
    ...input,
    discountAmount,
    note: input.note ?? "Test invoice issued without collection",
    expectedChargeRevision: review.appointment.chargeRevision,
    expectedGrandTotal: quote.grandTotal,
  });
}
