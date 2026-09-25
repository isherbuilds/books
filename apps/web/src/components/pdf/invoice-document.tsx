import { ZERO_MONEY, formatMoney, isZeroMoney } from "@accly/api/core/money";
import { formatBusinessDate } from "@accly/api/lib/business-date";
import { INDIAN_STATES } from "@accly/api/lib/indian-states";
import type { PrintSnapshot } from "@accly/db/schema/documents";
import type { CSSProperties } from "react";

import {
  DetailRow,
  PrintedDocument,
  SectionHeading,
  TotalPanel,
  TotalRow,
  colors,
} from "@/components/pdf/parts";
import type { InvoiceDetail } from "@/lib/invoices";

const numericCell: CSSProperties = { flex: 1, textAlign: "right" };

/** A posted invoice: `renderInvoicePdf` refuses one without a number or snapshot. */
export type PrintableInvoice = InvoiceDetail & { number: string; printSnapshot: PrintSnapshot };

export function InvoiceDocument({ data }: { data: PrintableInvoice }) {
  const { organization, party } = data.printSnapshot;

  if (!party) throw new Error("An invoice document requires a buyer in its print snapshot");

  let hasDiscount = false;
  let hasSplitTax = false;
  let hasIgst = false;
  let taxable = ZERO_MONEY;
  let cgst = ZERO_MONEY;
  let sgst = ZERO_MONEY;
  let igst = ZERO_MONEY;

  for (const line of data.lines) {
    hasDiscount ||= !isZeroMoney(line.discountPaise);
    hasSplitTax ||= !isZeroMoney(line.cgstPaise) || !isZeroMoney(line.sgstPaise);
    hasIgst ||= !isZeroMoney(line.igstPaise);
    taxable += line.amountPaise;
    cgst += line.cgstPaise;
    sgst += line.sgstPaise;
    igst += line.igstPaise;
  }

  const placeOfSupply = data.placeOfSupplyStateCode
    ? `${INDIAN_STATES[data.placeOfSupplyStateCode] ?? data.placeOfSupplyStateCode} (${data.placeOfSupplyStateCode})`
    : "—";

  return (
    <PrintedDocument
      organization={organization}
      kind="Invoice"
      number={data.number}
      cancelled={data.state === "cancelled"}
    >
      <section style={{ display: "flex", gap: 20, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <SectionHeading>Seller</SectionHeading>
          <div style={{ fontWeight: 700 }}>{organization.legalName}</div>
          <div>{organization.address}</div>
          {organization.gstin ? <div>GSTIN {organization.gstin}</div> : null}
          <div>PAN {organization.pan}</div>
        </div>
        <div style={{ flex: 1 }}>
          <SectionHeading>Buyer</SectionHeading>
          <div style={{ fontWeight: 700 }}>{party.name}</div>
          <div>{party.address}</div>
          {party.gstin ? <div>GSTIN {party.gstin}</div> : null}
          {party.pan ? <div>PAN {party.pan}</div> : null}
        </div>
      </section>

      <section style={{ marginBottom: 18 }}>
        <DetailRow label="Date">{formatBusinessDate(data.documentDate)}</DetailRow>
        <DetailRow label="Due date">
          {data.dueDate ? formatBusinessDate(data.dueDate) : "—"}
        </DetailRow>
        <DetailRow label="Place of supply">{placeOfSupply}</DetailRow>
      </section>

      <section>
        <div
          style={{
            backgroundColor: colors.panel,
            borderBottom: `1px solid ${colors.border}`,
            color: colors.muted,
            display: "flex",
            fontSize: 8,
            fontWeight: 700,
            gap: 5,
            padding: "8px 4px",
          }}
        >
          <span style={{ width: 15 }}>#</span>
          <span style={{ flex: 2 }}>Description</span>
          <span style={numericCell}>HSN/SAC</span>
          <span style={numericCell}>Qty</span>
          <span style={numericCell}>Unit price</span>
          {hasDiscount ? <span style={numericCell}>Discount</span> : null}
          <span style={numericCell}>Taxable</span>
          <span style={numericCell}>GST rate</span>
          {hasSplitTax ? <span style={numericCell}>CGST</span> : null}
          {hasSplitTax ? <span style={numericCell}>SGST</span> : null}
          {hasIgst ? <span style={numericCell}>IGST</span> : null}
        </div>
        {data.lines.map((line, index) => (
          <div
            key={line.id}
            style={{
              borderBottom: `1px solid ${colors.border}`,
              breakInside: "avoid",
              display: "flex",
              fontSize: 8,
              gap: 5,
              padding: "8px 4px",
            }}
          >
            <span style={{ width: 15 }}>{index + 1}</span>
            <span style={{ flex: 2 }}>{line.description}</span>
            <span style={numericCell}>{line.hsnSac ?? "—"}</span>
            <span style={numericCell}>
              {line.quantity ?? "—"}
              {line.unit ? ` ${line.unit}` : ""}
            </span>
            <span style={numericCell}>
              {line.unitPricePaise === null ? "—" : formatMoney(line.unitPricePaise)}
            </span>
            {hasDiscount ? (
              <span style={numericCell}>{formatMoney(line.discountPaise)}</span>
            ) : null}
            <span style={numericCell}>{formatMoney(line.amountPaise)}</span>
            <span style={numericCell}>
              {line.rateBasisPoints === null ? "—" : `${line.rateBasisPoints / 100}%`}
            </span>
            {hasSplitTax ? <span style={numericCell}>{formatMoney(line.cgstPaise)}</span> : null}
            {hasSplitTax ? <span style={numericCell}>{formatMoney(line.sgstPaise)}</span> : null}
            {hasIgst ? <span style={numericCell}>{formatMoney(line.igstPaise)}</span> : null}
          </div>
        ))}
      </section>

      {/* The same rows as the on-screen totals: the lines are already net of discount. */}
      <TotalPanel label="Total" amountPaise={data.totalPaise}>
        {isZeroMoney(data.discountPaise) ? null : (
          <>
            <TotalRow label="Subtotal" amountPaise={taxable + data.discountPaise} />
            <TotalRow label="Discount" amountPaise={-data.discountPaise} />
          </>
        )}
        <TotalRow label="Taxable" amountPaise={taxable} />
        {hasSplitTax ? <TotalRow label="CGST" amountPaise={cgst} /> : null}
        {hasSplitTax ? <TotalRow label="SGST" amountPaise={sgst} /> : null}
        {hasIgst ? <TotalRow label="IGST" amountPaise={igst} /> : null}
        <TotalRow label="Round-off" amountPaise={data.roundOffPaise} />
      </TotalPanel>

      {/* CGST Rules, rule 46(q): the supplier or an authorised representative signs. */}
      <section
        style={{
          breakInside: "avoid",
          marginLeft: "auto",
          marginTop: 24,
          textAlign: "right",
          width: 300,
        }}
      >
        <div>For {organization.legalName}</div>
        <div
          style={{
            borderTop: `1px solid ${colors.border}`,
            color: colors.muted,
            marginTop: 40,
            paddingTop: 4,
          }}
        >
          Authorised signatory
        </div>
      </section>
    </PrintedDocument>
  );
}
