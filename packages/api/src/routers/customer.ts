import { db } from "@accly/db";
import { nextCounter } from "@accly/db/counter";
import { attachments } from "@accly/db/schema/attachments";
import { departments } from "@accly/db/schema/departments";
import { invoices } from "@accly/db/schema/invoices";
import { opdAppointments } from "@accly/db/schema/opd-appointments";
import { customers } from "@accly/db/schema/customers";
import { customerPayers } from "@accly/db/schema/customer-payers";
import { payers } from "@accly/db/schema/payers";
import { practitioners } from "@accly/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { conflict } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { invoiceBalancesFor } from "../lib/invoice-balance";
import { fromPaise, toSignedPaise } from "../lib/invoice-math";
import { normalizePhone } from "../lib/phone";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dateOnly, likePattern, phone, searchQuery, shortName } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

const sponsorInput = z
  .object({
    payerId: z.string(),
    policyNumber: z.string().trim().max(100).optional(),
    employeeNumber: z.string().trim().max(100).optional(),
  })
  .nullable()
  .optional();

const customerFields = z.object({
  name: shortName,
  phone,
  sex: z.enum(["male", "female", "other", "unknown"]),
  dateOfBirth: dateOnly,
  dobEstimated: z.boolean(),
  address: z.string().trim().max(500).default(""),
  email: z.email().nullish(),
  uid: z.string().trim().min(1).max(100).nullish(),
  sponsor: sponsorInput,
});

const registerInput = orgInput.extend(customerFields.shape);

const updateInput = orgInput.extend({
  customerId: z.string(),
  updatedAt: z.iso.datetime({ precision: 3 }),
  ...customerFields.shape,
});

// A foreign customer id must read as absent, not as a customer with no visits — this
// is what turns it into NOT_FOUND rather than an empty list.
async function assertCustomerInScope(orgId: string, customerId: string): Promise<void> {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.id, customerId)))
    .limit(1);

  if (!customer) {
    throw new ORPCError("NOT_FOUND", { message: "That customer no longer exists." });
  }
}

// A deactivated payer keeps its history but takes no new links; foreign ids are
// indistinguishable from inactive ones on purpose.
async function assertActivePayer(orgId: string, payerId: string): Promise<void> {
  const [payer] = await db
    .select({ id: payers.id })
    .from(payers)
    .where(and(eq(payers.orgId, orgId), eq(payers.id, payerId), eq(payers.active, true)))
    .limit(1);
  if (!payer) {
    throw new ORPCError("NOT_FOUND", { message: "That sponsor is not available." });
  }
}

export const customerRouter = {
  register: orgProcedure({ customer: ["create"] }, registerInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const { orgSlug: _claim, sponsor, ...fields } = input;
      const id = Bun.randomUUIDv7();
      const [settings] = await Promise.all([
        // Bounded staleness is acceptable for numbering and keeps the counter lock window minimal.
        readOrgSettings(scope.orgId),
        sponsor ? assertActivePayer(scope.orgId, sponsor.payerId) : undefined,
      ]);

      let customer: typeof customers.$inferSelect;
      try {
        customer = await db.transaction(async (tx) => {
          const seq = await nextCounter(tx, scope.orgId, "code");
          const code = `${settings.codePrefix}${String(seq).padStart(6, "0")}`;

          const [row] = await tx
            .insert(customers)
            .values({
              ...fields,
              id,
              orgId: scope.orgId,
              code,
              email: fields.email ?? null,
              uid: fields.uid ?? null,
              createdBy: scope.userId,
            })
            .returning();

          if (!row) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Failed to register customer",
            });
          }
          if (sponsor) {
            await tx.insert(customerPayers).values({
              id: Bun.randomUUIDv7(),
              orgId: scope.orgId,
              customerId: id,
              payerId: sponsor.payerId,
              policyNumber: sponsor.policyNumber ?? null,
              employeeNumber: sponsor.employeeNumber ?? null,
            });
          }
          return row;
        });
      } catch (error) {
        const constraint = uniqueViolationConstraint(error);
        if (constraint === "customers_org_uid_idx") {
          throw conflict("uid_taken", "A customer with this UID already exists.");
        }
        if (constraint !== undefined) {
          throw new ORPCError("CONFLICT", {
            message: "Those details match a customer who already exists.",
          });
        }
        throw error;
      }

      audit({
        action: "customer.register",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `customer:${id}`,
      });

      return customer;
    },
  ),

  search: orgProcedure(
    { customer: ["read"] },
    orgInput.extend({
      query: searchQuery,
      phone: z
        .string()
        .trim()
        .max(20)
        .refine((value) => normalizePhone(value).length >= 4, {
          message: "Phone must contain at least 4 digits",
        })
        .optional(),
      // Keyset on the UUIDv7 id alone: ids are minted at registration so they order
      // chronologically, and a timestamp cursor's millisecond truncation loses rows.
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  ).handler(async ({ context, input }) => {
    const normalizedPhone = input.phone ? normalizePhone(input.phone) : undefined;
    const normalizedQuery = input.query ? normalizePhone(input.query) : "";
    const queryPattern = input.query ? likePattern(input.query) : undefined;
    const phoneDigits = sql<string>`regexp_replace(${customers.phone}, '\\D', '', 'g')`;
    const scoped = and(
      eq(customers.orgId, context.scope.orgId),
      input.cursor ? lt(customers.id, input.cursor) : undefined,
      normalizedPhone ? eq(phoneDigits, normalizedPhone) : undefined,
      queryPattern
        ? or(
            ilike(customers.name, queryPattern),
            ilike(customers.code, queryPattern),
            normalizedQuery.length >= 4
              ? ilike(phoneDigits, likePattern(normalizedQuery))
              : undefined,
          )
        : undefined,
    );

    // Clinical history and extended contact fields stay behind the record endpoint.
    const items = await db
      .select({
        id: customers.id,
        code: customers.code,
        name: customers.name,
        phone: customers.phone,
        sex: customers.sex,
        dateOfBirth: customers.dateOfBirth,
        dobEstimated: customers.dobEstimated,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(scoped)
      .orderBy(desc(customers.id))
      .limit(input.limit + 1);

    const hasNextPage = items.length > input.limit;
    if (hasNextPage) {
      items.pop();
    }
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasNextPage && last ? last.id : null,
    };
  }),

  // Gated on `opd:read`, not `customer:read`: a clerk who may correct a phone number
  // is not thereby entitled to who the customer has been seeing.
  visits: orgProcedure(
    { opd: ["read"] },
    orgInput.extend({
      customerId: z.string(),
      // Keyset on (business_date, id): a visit is ordered by the day it happened, so a
      // booking made today for next week must not sort above last week's attendance.
      cursor: z.object({ businessDate: z.string(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [, rows] = await Promise.all([
      assertCustomerInScope(scope.orgId, input.customerId),
      db
        .select({
          id: opdAppointments.id,
          businessDate: opdAppointments.businessDate,
          status: opdAppointments.status,
          tokenNumber: opdAppointments.tokenNumber,
          practitionerName: practitioners.name,
          departmentName: departments.name,
        })
        .from(opdAppointments)
        .innerJoin(
          practitioners,
          and(
            eq(practitioners.orgId, scope.orgId),
            eq(practitioners.id, opdAppointments.practitionerId),
          ),
        )
        .innerJoin(
          departments,
          and(eq(departments.orgId, scope.orgId), eq(departments.id, opdAppointments.departmentId)),
        )
        .where(
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.customerId, input.customerId),
            input.cursor
              ? sql`(${opdAppointments.businessDate}, ${opdAppointments.id}) < (${input.cursor.businessDate}::date, ${input.cursor.id})`
              : undefined,
          ),
        )
        .orderBy(desc(opdAppointments.businessDate), desc(opdAppointments.id))
        .limit(input.limit + 1),
    ]);

    const hasNextPage = rows.length > input.limit;
    if (hasNextPage) {
      rows.pop();
    }

    const visitIds = rows.map((row) => row.id);
    const [prescriptionCounts, visitInvoices] = visitIds.length
      ? await Promise.all([
          db
            .select({ targetId: attachments.targetId, total: count() })
            .from(attachments)
            .where(
              and(
                eq(attachments.orgId, scope.orgId),
                eq(attachments.targetType, "prescription"),
                inArray(attachments.targetId, visitIds),
              ),
            )
            .groupBy(attachments.targetId),
          db
            .select({
              id: invoices.id,
              opdAppointmentId: invoices.opdAppointmentId,
              grandTotal: invoices.grandTotal,
            })
            .from(invoices)
            .where(
              and(eq(invoices.orgId, scope.orgId), inArray(invoices.opdAppointmentId, visitIds)),
            ),
        ])
      : [[], []];

    const balances = await invoiceBalancesFor(db, scope.orgId, visitInvoices);
    const countByVisit = new Map(prescriptionCounts.map((row) => [row.targetId, row.total]));
    const outstandingByVisit = new Map<string, number>();
    for (const invoice of visitInvoices) {
      const outstanding = balances.get(invoice.id)?.outstanding ?? "0.00";
      outstandingByVisit.set(
        invoice.opdAppointmentId,
        (outstandingByVisit.get(invoice.opdAppointmentId) ?? 0) + toSignedPaise(outstanding),
      );
    }

    const items = rows.map((row) => ({
      ...row,
      prescriptionCount: countByVisit.get(row.id) ?? 0,
      outstanding: fromPaise(outstandingByVisit.get(row.id) ?? 0),
    }));

    const last = rows[rows.length - 1];
    return {
      items,
      nextCursor: hasNextPage && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }),

  account: orgProcedure({ billing: ["read"] }, orgInput.extend({ customerId: z.string() })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const [, rows] = await Promise.all([
        assertCustomerInScope(scope.orgId, input.customerId),
        db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            grandTotal: invoices.grandTotal,
            currency: invoices.currency,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .where(and(eq(invoices.orgId, scope.orgId), eq(invoices.customerId, input.customerId)))
          .orderBy(desc(invoices.createdAt), desc(invoices.id)),
      ]);

      const balances = await invoiceBalancesFor(db, scope.orgId, rows);
      const items = rows.map((invoice) => {
        const balance = balances.get(invoice.id);
        return {
          ...invoice,
          paymentsTotal: balance?.paymentsTotal ?? "0.00",
          outstanding: balance?.outstanding ?? "0.00",
        };
      });

      const openInvoices = items.filter((invoice) => toSignedPaise(invoice.outstanding) !== 0);

      return {
        invoices: items,
        openCount: openInvoices.length,
        outstanding: fromPaise(
          openInvoices.reduce((sum, invoice) => sum + toSignedPaise(invoice.outstanding), 0),
        ),
      };
    },
  ),

  get: orgProcedure({ customer: ["read"] }, orgInput.extend({ customerId: z.string() })).handler(
    async ({ context, input }) => {
      // Two joined tables, so Drizzle cannot nullify `sponsor` as one object; the
      // payer columns are only null when the link row is absent.
      const [row] = await db
        .select({
          customer: customers,
          payerId: payers.id,
          payerName: payers.name,
          payerType: payers.type,
          policyNumber: customerPayers.policyNumber,
          employeeNumber: customerPayers.employeeNumber,
        })
        .from(customers)
        .leftJoin(
          customerPayers,
          and(
            eq(customerPayers.orgId, context.scope.orgId),
            eq(customerPayers.customerId, customers.id),
          ),
        )
        .leftJoin(
          payers,
          and(eq(payers.orgId, context.scope.orgId), eq(payers.id, customerPayers.payerId)),
        )
        .where(and(eq(customers.orgId, context.scope.orgId), eq(customers.id, input.customerId)))
        .limit(1);

      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "That customer no longer exists." });
      }
      return {
        ...row.customer,
        updatedAt: row.customer.updatedAt.toISOString(),
        sponsor:
          row.payerId !== null && row.payerName !== null && row.payerType !== null
            ? {
                payerId: row.payerId,
                payerName: row.payerName,
                payerType: row.payerType,
                policyNumber: row.policyNumber,
                employeeNumber: row.employeeNumber,
              }
            : null,
      };
    },
  ),

  update: orgProcedure({ customer: ["update"] }, updateInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const { orgSlug: _claim, customerId, updatedAt, sponsor, ...fields } = input;
      if (sponsor) await assertActivePayer(scope.orgId, sponsor.payerId);

      let customer: typeof customers.$inferSelect;
      try {
        customer = await db.transaction(async (tx) => {
          const [row] = await tx
            .update(customers)
            .set({
              ...fields,
              email: fields.email ?? null,
              uid: fields.uid ?? null,
              updatedAt: sql`greatest(statement_timestamp(), ${customers.updatedAt} + interval '1 millisecond')::timestamptz(3)`,
            })
            .where(
              and(
                eq(customers.orgId, scope.orgId),
                eq(customers.id, customerId),
                eq(customers.updatedAt, new Date(updatedAt)),
              ),
            )
            .returning();

          if (!row) {
            throw conflict("stale_record", "This customer changed after you opened it.");
          }
          if (sponsor === null) {
            await tx
              .delete(customerPayers)
              .where(
                and(
                  eq(customerPayers.orgId, scope.orgId),
                  eq(customerPayers.customerId, customerId),
                ),
              );
          } else if (sponsor) {
            await tx
              .insert(customerPayers)
              .values({
                id: Bun.randomUUIDv7(),
                orgId: scope.orgId,
                customerId,
                payerId: sponsor.payerId,
                policyNumber: sponsor.policyNumber ?? null,
                employeeNumber: sponsor.employeeNumber ?? null,
              })
              .onConflictDoUpdate({
                target: [customerPayers.orgId, customerPayers.customerId],
                set: {
                  payerId: sponsor.payerId,
                  policyNumber: sponsor.policyNumber ?? null,
                  employeeNumber: sponsor.employeeNumber ?? null,
                },
              });
          }
          return row;
        });
      } catch (error) {
        const constraint = uniqueViolationConstraint(error);
        if (constraint === "customers_org_uid_idx") {
          throw conflict("uid_taken", "A customer with this UID already exists.");
        }
        if (constraint !== undefined) {
          throw new ORPCError("CONFLICT", {
            message: "Those details match a customer who already exists.",
          });
        }
        throw error;
      }

      audit({
        action: "customer.update",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `customer:${customerId}`,
      });

      return { ...customer, updatedAt: customer.updatedAt.toISOString() };
    },
  ),
};
