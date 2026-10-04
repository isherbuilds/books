import { formatMoney, isZeroMoney } from "@accly/api/core/money";
import { invoicePrintTitle } from "@accly/api/core/tax";
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
import type { NoteDetail } from "@/lib/notes";

const numericCell: CSSProperties = { flex: 1, textAlign: "right" };

/** Numbered documents with immutable supplier and recipient print details. */
type PrintableInvoice = (InvoiceDetail | NoteDetail) & {
  number: string;
  printSnapshot: PrintSnapshot;
};

export function InvoiceDocument({ data }: { data: PrintableInvoice }) {
  const { organization, party, shipTo } = data.printSnapshot;

  if (!party) throw new Error("A printed invoice or note requires a recipient");

  const note = "against" in data ? data : null;

  const title =
    "printClass" in data
      ? invoicePrintTitle(data.printClass)
      : data.type === "creditNote"
        ? "Credit Note"
        : "Debit Note";

  // The server sums the document; a column shows only when some line carries it.
  const { taxablePaise, cgstPaise, sgstPaise, igstPaise } = data.totals;
  const hasDiscount = data.lines.some((line) => !isZeroMoney(line.discountPaise));
  // Only packaged goods carry an MRP, so the column appears only when a line has one.
  const hasMrp = data.lines.some((line) => line.mrpPaise !== null);
  const hasSplitTax = !isZeroMoney(cgstPaise) || !isZeroMoney(sgstPaise);
  const hasIgst = !isZeroMoney(igstPaise);
  const hasZeroTax = note !== null && !hasSplitTax && !hasIgst;

  const stateLabel = (code: string) => `${INDIAN_STATES[code] ?? code} (${code})`;

  const placeOfSupply = data.placeOfSupplyStateCode
    ? stateLabel(data.placeOfSupplyStateCode)
    : null;

  return (
    <PrintedDocument
      organization={organization}
      kind={title}
      number={data.number}
      cancelled={data.state === "cancelled"}
    >
      {/* CGST rule 46(d)/(e): the recipient with its state; 46(o): the address of delivery. */}
      <div style={{ display: "flex", gap: 24, marginBottom: 18 }}>
        <section style={{ flex: 1 }}>
          <SectionHeading>{note ? "Recipient" : "Bill to"}</SectionHeading>
          <div style={{ fontWeight: 700 }}>{party.name}</div>
          <div style={{ whiteSpace: "pre-line" }}>{party.address}</div>
          <div>State {stateLabel(party.stateCode)}</div>
          <div>{party.gstin ? `GSTIN ${party.gstin}` : "Unregistered"}</div>
          {party.pan ? <div>PAN {party.pan}</div> : null}
        </section>
        {shipTo ? (
          <section style={{ flex: 1 }}>
            <SectionHeading>Ship to</SectionHeading>
            <div style={{ whiteSpace: "pre-line" }}>{shipTo.address}</div>
            <div>State {stateLabel(shipTo.stateCode)}</div>
          </section>
        ) : null}
      </div>

      <section style={{ marginBottom: 18 }}>
        <DetailRow label="Date">{formatBusinessDate(data.documentDate)}</DetailRow>
        {data.dueDate ? (
          <DetailRow label="Due date">{formatBusinessDate(data.dueDate)}</DetailRow>
        ) : null}
        {note?.against ? (
          <>
            <DetailRow label={note.type === "creditNote" ? "Original invoice" : "Original bill"}>
              {note.against.number}
            </DetailRow>
            <DetailRow label="Original document date">
              {formatBusinessDate(note.against.documentDate)}
            </DetailRow>
            {note.type === "debitNote" && note.against.reference ? (
              <DetailRow label="Supplier invoice">{note.against.reference}</DetailRow>
            ) : null}
            <DetailRow label="Reason">{note.narration}</DetailRow>
          </>
        ) : null}
        {placeOfSupply ? <DetailRow label="Place of supply">{placeOfSupply}</DetailRow> : null}
        {/* CGST rule 46(p). Outward reverse charge is not modelled (accounting-core deferral). */}
        {"printClass" in data && data.printClass === "taxInvoice" ? (
          <DetailRow label="Reverse charge">No</DetailRow>
        ) : null}
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
          {note ? null : <span style={numericCell}>Qty</span>}
          {hasMrp ? <span style={numericCell}>MRP</span> : null}
          {note ? null : <span style={numericCell}>Rate</span>}
          {hasDiscount ? <span style={numericCell}>Discount</span> : null}
          <span style={numericCell}>Taxable</span>
          <span style={numericCell}>GST rate</span>
          {hasSplitTax ? <span style={numericCell}>CGST</span> : null}
          {hasSplitTax ? <span style={numericCell}>SGST</span> : null}
          {hasIgst ? <span style={numericCell}>IGST</span> : null}
          {hasZeroTax ? <span style={numericCell}>GST</span> : null}
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
            {note ? null : (
              <span style={numericCell}>
                {line.quantity ?? "—"}
                {line.unit ? ` ${line.unit}` : ""}
              </span>
            )}
            {hasMrp ? (
              <span style={numericCell}>
                {line.mrpPaise === null ? "—" : formatMoney(line.mrpPaise)}
              </span>
            ) : null}
            {note ? null : (
              <span style={numericCell}>
                {line.unitPricePaise === null ? "—" : formatMoney(line.unitPricePaise)}
              </span>
            )}
            {hasDiscount ? (
              <span style={numericCell}>{formatMoney(line.discountPaise)}</span>
            ) : null}
            <span style={numericCell}>{formatMoney(line.amountPaise)}</span>
            <span style={numericCell}>
              {line.rateBasisPoints === null
                ? note
                  ? "0%"
                  : "—"
                : `${line.rateBasisPoints / 100}%`}
            </span>
            {hasSplitTax ? <span style={numericCell}>{formatMoney(line.cgstPaise)}</span> : null}
            {hasSplitTax ? <span style={numericCell}>{formatMoney(line.sgstPaise)}</span> : null}
            {hasIgst ? <span style={numericCell}>{formatMoney(line.igstPaise)}</span> : null}
            {hasZeroTax ? (
              <span style={numericCell}>
                {formatMoney(line.cgstPaise + line.sgstPaise + line.igstPaise)}
              </span>
            ) : null}
          </div>
        ))}
      </section>

      {/* The same rows as the on-screen totals: the lines are already net of discount. */}
      <TotalPanel label="Total" amountPaise={data.totalPaise}>
        {isZeroMoney(data.discountPaise) ? null : (
          <>
            <TotalRow label="Subtotal" amountPaise={taxablePaise + data.discountPaise} />
            <TotalRow
              label={
                data.printSnapshot.discountBasisPoints === undefined
                  ? "Discount"
                  : `Discount (${data.printSnapshot.discountBasisPoints / 100}%)`
              }
              amountPaise={-data.discountPaise}
            />
          </>
        )}
        <TotalRow label="Taxable" amountPaise={taxablePaise} />
        {hasSplitTax ? <TotalRow label="CGST" amountPaise={cgstPaise} /> : null}
        {hasSplitTax ? <TotalRow label="SGST" amountPaise={sgstPaise} /> : null}
        {hasIgst ? <TotalRow label="IGST" amountPaise={igstPaise} /> : null}
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
