import { db } from "@accly/db";
import { accounts } from "@accly/db/schema/accounts";
import { departments } from "@accly/db/schema/departments";
import { creditNoteLines } from "@accly/db/schema/credit-note-lines";
import { creditNotes } from "@accly/db/schema/credit-notes";
import { invoiceLines } from "@accly/db/schema/invoice-lines";
import { invoices } from "@accly/db/schema/invoices";
import { opdAppointments } from "@accly/db/schema/opd-appointments";
import { customers } from "@accly/db/schema/customers";
import { payments } from "@accly/db/schema/payments";
import { practitioners } from "@accly/db/schema/practitioners";
import { refunds } from "@accly/db/schema/refunds";
import { journalEntries } from "@accly/db/schema/journal-entries";
import { journalLines } from "@accly/db/schema/journal-lines";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { formatDecimal as formatMoney } from "../core/money";
import { businessDate } from "../lib/business-date";
import { closeExpiredBookings } from "../lib/opd-close";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import {
  buildBalanceSheet,
  buildGstReport,
  buildTrialBalance,
  type AccountAggregate,
  type GstBucket,
} from "../lib/report-math";
import { paymentMethod, type PaymentMethod } from "../lib/schemas";

const reportDate = z.iso.date();

const periodInput = orgInput.extend({ from: reportDate, to: reportDate });

const asOfInput = orgInput.extend({ asOf: reportDate });

const DAY_MS = 24 * 60 * 60 * 1_000;

// `maxDays` belongs only to reports whose row count grows with the period. Trial
// balance and balance sheet return one row per account whatever the range, and the
// pool's statement timeout already bounds a long scan.
const GST_BOUND = { report: "GST register", maxDays: 366 };

const COLLECTIONS_BOUND = { report: "Daily collections", maxDays: 92 };

const REGISTER_BOUND = { report: "OPD register", maxDays: 31 };

const PAYMENT_METHODS = paymentMethod.options;

function assertValidPeriod(
  from: string,
  to: string,
  bound?: { report: string; maxDays: number },
): void {
  if (from > to) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The start date must not be after the end date",
    });
  }

  if (!bound) return;

  const inclusiveDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

  if (inclusiveDays > bound.maxDays) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${bound.report} covers at most ${bound.maxDays} days`,
    });
  }
}

async function accountAggregates(
  orgId: string,
  ...datePredicates: SQL<unknown>[]
): Promise<AccountAggregate[]> {
  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::bigint`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::bigint`,
    })
    .from(accounts)
    .innerJoin(
      journalLines,
      and(eq(journalLines.accountId, accounts.id), eq(journalLines.orgId, orgId)),
    )
    .innerJoin(
      journalEntries,
      and(eq(journalEntries.id, journalLines.entryId), eq(journalEntries.orgId, orgId)),
    )
    .where(and(eq(accounts.orgId, orgId), ...datePredicates))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type);

  return rows.map((row) => ({
    ...row,
    debit: BigInt(row.debit),
    credit: BigInt(row.credit),
  }));
}

export const reportRouter = {
  trialBalance: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to);

      const [openingRows, activityRows] = await Promise.all([
        accountAggregates(context.scope.orgId, lt(journalEntries.entryDate, input.from)),
        accountAggregates(
          context.scope.orgId,
          gte(journalEntries.entryDate, input.from),
          lte(journalEntries.entryDate, input.to),
        ),
      ]);

      return buildTrialBalance({
        from: input.from,
        to: input.to,
        openingRows,
        activityRows,
      });
    },
  ),

  balanceSheet: orgProcedure({ report: ["readFinancial"] }, asOfInput).handler(
    async ({ context, input }) => {
      const aggregates = await accountAggregates(
        context.scope.orgId,
        lte(journalEntries.entryDate, input.asOf),
      );

      return buildBalanceSheet({ asOf: input.asOf, aggregates });
    },
  ),

  dailyCollections: orgProcedure({ report: ["readDailyCollections"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, COLLECTIONS_BOUND);
      const orgId = context.scope.orgId;

      const [paymentRows, refundRows] = await Promise.all([
        db
          .select({
            businessDate: payments.businessDate,
            method: sql<PaymentMethod>`${payments.method}`,
            amount: sql<string>`sum(${payments.amount})::bigint`,
          })
          .from(payments)
          .where(
            and(
              eq(payments.orgId, orgId),
              gte(payments.businessDate, input.from),
              lte(payments.businessDate, input.to),
            ),
          )
          .groupBy(payments.businessDate, payments.method),
        db
          .select({
            businessDate: refunds.businessDate,
            method: sql<PaymentMethod>`${refunds.method}`,
            amount: sql<string>`sum(${refunds.amount})::bigint`,
          })
          .from(refunds)
          .where(
            and(
              eq(refunds.orgId, orgId),
              gte(refunds.businessDate, input.from),
              lte(refunds.businessDate, input.to),
            ),
          )
          .groupBy(refunds.businessDate, refunds.method),
      ]);

      const buckets = new Map<
        string,
        { businessDate: string; method: PaymentMethod; payments: bigint; refunds: bigint }
      >();

      for (const row of paymentRows) {
        buckets.set(`${row.businessDate}:${row.method}`, {
          businessDate: row.businessDate,
          method: row.method,
          payments: BigInt(row.amount),
          refunds: 0n,
        });
      }

      for (const row of refundRows) {
        const key = `${row.businessDate}:${row.method}`;

        const bucket = buckets.get(key) ?? {
          businessDate: row.businessDate,
          method: row.method,
          payments: 0n,
          refunds: 0n,
        };

        bucket.refunds += BigInt(row.amount);
        buckets.set(key, bucket);
      }

      const amounts = [...buckets.values()].sort(
        (left, right) =>
          left.businessDate.localeCompare(right.businessDate) ||
          left.method.localeCompare(right.method),
      );

      // SAFETY: Mapping the complete PAYMENT_METHODS tuple provides every PaymentMethod key.
      const methodTotals = Object.fromEntries(
        PAYMENT_METHODS.map((method) => [method, { payments: 0n, refunds: 0n }]),
      ) as Record<PaymentMethod, { payments: bigint; refunds: bigint }>;

      const days = new Map<
        string,
        {
          businessDate: string;
          byMethod: Record<PaymentMethod, bigint>;
          payments: bigint;
          refunds: bigint;
        }
      >();

      let paymentsTotal = 0n;
      let refundsTotal = 0n;

      for (const row of amounts) {
        methodTotals[row.method].payments += row.payments;
        methodTotals[row.method].refunds += row.refunds;
        paymentsTotal += row.payments;
        refundsTotal += row.refunds;

        const day = days.get(row.businessDate) ?? {
          businessDate: row.businessDate,
          // SAFETY: The complete PAYMENT_METHODS tuple supplies every key.
          byMethod: Object.fromEntries(PAYMENT_METHODS.map((method) => [method, 0n])) as Record<
            PaymentMethod,
            bigint
          >,
          payments: 0n,
          refunds: 0n,
        };

        day.byMethod[row.method] += row.payments - row.refunds;
        day.payments += row.payments;
        day.refunds += row.refunds;
        days.set(row.businessDate, day);
      }

      const rows = [...days.values()].map((day) => ({
        businessDate: day.businessDate,
        // SAFETY: The complete PAYMENT_METHODS tuple supplies every key.
        byMethod: Object.fromEntries(
          PAYMENT_METHODS.map((method) => [method, formatMoney(day.byMethod[method])]),
        ) as Record<PaymentMethod, string>,
        payments: formatMoney(day.payments),
        refunds: formatMoney(day.refunds),
        net: formatMoney(day.payments - day.refunds),
      }));

      const byMethod = PAYMENT_METHODS.map((method) => ({
        method,
        payments: formatMoney(methodTotals[method].payments),
        refunds: formatMoney(methodTotals[method].refunds),
        net: formatMoney(methodTotals[method].payments - methodTotals[method].refunds),
      }));

      return {
        from: input.from,
        to: input.to,
        rows,
        byMethod,
        totals: {
          payments: formatMoney(paymentsTotal),
          refunds: formatMoney(refundsTotal),
          net: formatMoney(paymentsTotal - refundsTotal),
        },
      };
    },
  ),

  opdRegister: orgProcedure({ report: ["readOpdRegister"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, REGISTER_BOUND);
      const { scope } = context;
      const settings = await readOrgSettings(scope.orgId);
      const now = new Date();
      const currentDay = businessDate(now, settings.timeZone);

      if (input.from < currentDay) {
        await closeExpiredBookings({
          orgId: scope.orgId,
          actorId: scope.userId,
          currentDay,
          now,
        });
      }

      const billed = sql<string>`coalesce((select sum(${invoices.grandTotal}) from ${invoices}
        where ${invoices.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`;

      const paid = sql<string>`coalesce((select sum(${payments.amount}) from ${payments}
        inner join ${invoices}
          on ${invoices.id} = ${payments.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${payments.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`;

      const credits = sql<string>`coalesce((select sum(${creditNotes.total}) from ${creditNotes}
        inner join ${invoices}
          on ${invoices.id} = ${creditNotes.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${creditNotes.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`;

      const refunded = sql<string>`coalesce((select sum(${refunds.amount}) from ${refunds}
        inner join ${invoices}
          on ${invoices.id} = ${refunds.invoiceId}
          and ${invoices.orgId} = ${scope.orgId}
        where ${refunds.orgId} = ${scope.orgId}
          and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`;

      const selected = await db
        .select({
          appointmentId: opdAppointments.id,
          businessDate: opdAppointments.businessDate,
          tokenNumber: opdAppointments.tokenNumber,
          customerName: customers.name,
          customerCode: customers.code,
          callerName: opdAppointments.callerName,
          practitionerName: practitioners.name,
          departmentName: departments.name,
          arrivalMode: opdAppointments.arrivalMode,
          status: opdAppointments.status,
          arrivedAt: opdAppointments.arrivedAt,
          billed,
          paid,
          credits,
          refunds: refunded,
        })
        .from(opdAppointments)
        .leftJoin(
          customers,
          and(eq(customers.id, opdAppointments.customerId), eq(customers.orgId, scope.orgId)),
        )
        .innerJoin(
          practitioners,
          and(
            eq(practitioners.id, opdAppointments.practitionerId),
            eq(practitioners.orgId, scope.orgId),
          ),
        )
        .innerJoin(
          departments,
          and(eq(departments.id, opdAppointments.departmentId), eq(departments.orgId, scope.orgId)),
        )
        .where(
          and(
            eq(opdAppointments.orgId, scope.orgId),
            gte(opdAppointments.businessDate, input.from),
            lte(opdAppointments.businessDate, input.to),
          ),
        )
        .orderBy(
          asc(opdAppointments.businessDate),
          asc(opdAppointments.dayOrderAt),
          asc(opdAppointments.id),
        );

      const byStatus = { booked: 0, checked_in: 0, cancelled: 0, no_show: 0 };
      let billedTotal = 0n;
      let paidTotal = 0n;
      let creditsTotal = 0n;
      let refundsTotal = 0n;

      const rows = selected.map((row) => {
        const billedPaise = BigInt(row.billed);
        const paidPaise = BigInt(row.paid);
        const creditsPaise = BigInt(row.credits);
        const refundsPaise = BigInt(row.refunds);
        billedTotal += billedPaise;
        paidTotal += paidPaise;
        creditsTotal += creditsPaise;
        refundsTotal += refundsPaise;
        byStatus[row.status] += 1;

        return {
          ...row,
          billed: formatMoney(billedPaise),
          paid: formatMoney(paidPaise),
          credits: formatMoney(creditsPaise),
          refunds: formatMoney(refundsPaise),
          outstanding: formatMoney(billedPaise - creditsPaise - paidPaise + refundsPaise),
        };
      });

      return {
        from: input.from,
        to: input.to,
        rows,
        totals: {
          appointments: rows.length,
          byStatus,
          billed: formatMoney(billedTotal),
          paid: formatMoney(paidTotal),
          credits: formatMoney(creditsTotal),
          refunds: formatMoney(refundsTotal),
          outstanding: formatMoney(billedTotal - creditsTotal - paidTotal + refundsTotal),
        },
      };
    },
  ),

  gst: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, GST_BOUND);
      const orgId = context.scope.orgId;

      // The stored Business Date, never `createdAt` reinterpreted through the current
      // timezone: an issued document's date does not move when settings change.
      const [invoiceBuckets, creditNoteBuckets] = await Promise.all([
        db
          .select({
            documentId: invoices.id,
            number: invoices.invoiceNumber,
            date: invoices.businessDate,
            customerName: invoices.customerName,
            customerCode: invoices.customerCode,
            taxRatePercent: invoiceLines.taxRatePercent,
            taxCode: invoiceLines.taxCode,
            taxableValue: sql<string>`sum(${invoiceLines.taxableValue})::bigint`,
            taxAmount: sql<string>`sum(${invoiceLines.taxAmount})::bigint`,
            gross: sql<string>`sum(${invoiceLines.gross})::bigint`,
          })
          .from(invoices)
          .innerJoin(
            invoiceLines,
            and(eq(invoiceLines.invoiceId, invoices.id), eq(invoiceLines.orgId, orgId)),
          )
          .where(
            and(
              eq(invoices.orgId, orgId),
              gte(invoices.businessDate, input.from),
              lte(invoices.businessDate, input.to),
            ),
          )
          .groupBy(
            invoices.id,
            invoices.invoiceNumber,
            invoices.businessDate,
            invoices.customerName,
            invoices.customerCode,
            invoiceLines.taxRatePercent,
            invoiceLines.taxCode,
          ),
        db
          .select({
            documentId: creditNotes.id,
            number: creditNotes.creditNoteNumber,
            date: creditNotes.businessDate,
            customerName: invoices.customerName,
            customerCode: invoices.customerCode,
            taxRatePercent: invoiceLines.taxRatePercent,
            taxCode: invoiceLines.taxCode,
            taxableValue: sql<string>`sum(${creditNoteLines.taxableValue})::bigint`,
            taxAmount: sql<string>`sum(${creditNoteLines.taxAmount})::bigint`,
            gross: sql<string>`sum(${creditNoteLines.gross})::bigint`,
          })
          .from(creditNotes)
          .innerJoin(
            invoices,
            and(eq(invoices.id, creditNotes.invoiceId), eq(invoices.orgId, orgId)),
          )
          .innerJoin(
            creditNoteLines,
            and(eq(creditNoteLines.creditNoteId, creditNotes.id), eq(creditNoteLines.orgId, orgId)),
          )
          .innerJoin(
            invoiceLines,
            and(eq(invoiceLines.id, creditNoteLines.invoiceLineId), eq(invoiceLines.orgId, orgId)),
          )
          .where(
            and(
              eq(creditNotes.orgId, orgId),
              gte(creditNotes.businessDate, input.from),
              lte(creditNotes.businessDate, input.to),
            ),
          )
          .groupBy(
            creditNotes.id,
            creditNotes.creditNoteNumber,
            creditNotes.businessDate,
            invoices.customerName,
            invoices.customerCode,
            invoiceLines.taxRatePercent,
            invoiceLines.taxCode,
          ),
      ]);

      const buckets: GstBucket[] = [
        ...invoiceBuckets.map((row) => ({
          ...row,
          docType: "invoice" as const,
          taxableValue: BigInt(row.taxableValue),
          taxAmount: BigInt(row.taxAmount),
          gross: BigInt(row.gross),
        })),
        ...creditNoteBuckets.map((row) => ({
          ...row,
          docType: "credit_note" as const,
          taxableValue: BigInt(row.taxableValue),
          taxAmount: BigInt(row.taxAmount),
          gross: BigInt(row.gross),
        })),
      ];

      return buildGstReport({
        from: input.from,
        to: input.to,
        buckets,
      });
    },
  ),
};
