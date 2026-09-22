import { amountInWords } from "@accly/api/core/amount-in-words";
import { formatMoney } from "@accly/api/core/money";
import type { ReceiptDetail } from "@accly/api/routers/receipt";
import type { CSSProperties, ReactNode } from "react";

import { formatBusinessDate } from "@accly/api/lib/business-date";

const colors = {
  ink: "#18181b",
  muted: "#71717a",
  border: "#d4d4d8",
  panel: "#f4f4f5",
  accent: "#075985",
  cancelled: "#b91c1c",
};

const documentStyle: CSSProperties = {
  color: colors.ink,
  fontSize: 10,
  lineHeight: 1.45,
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        borderBottom: `1px solid ${colors.border}`,
        display: "flex",
        gap: 12,
        justifyContent: "space-between",
        padding: "8px 0",
      }}
    >
      <span style={{ color: colors.muted }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: "right" }}>{children}</span>
    </div>
  );
}

export function ReceiptVoucher({ data }: { data: ReceiptDetail }) {
  if (!data.printSnapshot || !data.number) {
    throw new Error("A receipt voucher requires a posted receipt snapshot and number");
  }

  const { organization, party, paymentMethod, lines } = data.printSnapshot;

  const organizationDetails = [
    organization.address,
    organization.gstin ? `GSTIN ${organization.gstin}` : "",
    organization.pan ? `PAN ${organization.pan}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main style={documentStyle}>
      <header
        style={{
          alignItems: "flex-start",
          borderBottom: `2px solid ${colors.ink}`,
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 20,
          paddingBottom: 10,
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, lineHeight: 1.2, margin: 0 }}>{organization.legalName}</h1>
          {organizationDetails ? (
            <p style={{ color: colors.muted, fontSize: 8, margin: "4px 0 0" }}>
              {organizationDetails}
            </p>
          ) : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>
            Receipt voucher
          </div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{data.number}</div>
        </div>
      </header>

      {data.state === "cancelled" ? (
        <div
          style={{
            border: `2px solid ${colors.cancelled}`,
            color: colors.cancelled,
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: 1.5,
            marginBottom: 16,
            padding: "6px 10px",
            textAlign: "center",
          }}
        >
          CANCELLED
        </div>
      ) : null}

      <section>
        <h2
          style={{
            color: colors.muted,
            fontSize: 8,
            letterSpacing: 0.4,
            margin: "0 0 6px",
            textTransform: "uppercase",
          }}
        >
          Receipt details
        </h2>
        <div>
          <DetailRow label="Date">{formatBusinessDate(data.documentDate)}</DetailRow>
          <DetailRow label="Received from">{party?.name ?? "—"}</DetailRow>
          <DetailRow label="Payment method">{paymentMethod ?? "—"}</DetailRow>
          <DetailRow label="Towards">{lines.map((line) => line.description).join("; ")}</DetailRow>
          <DetailRow label="Reference">{data.reference ?? "—"}</DetailRow>
        </div>
      </section>

      <section
        style={{
          backgroundColor: colors.panel,
          breakInside: "avoid",
          marginLeft: "auto",
          marginTop: 18,
          padding: 12,
          width: 300,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 12,
            fontWeight: 700,
            justifyContent: "space-between",
          }}
        >
          <span>Amount received</span>
          <span style={{ color: colors.accent }}>{formatMoney(data.totalPaise)}</span>
        </div>
        <p style={{ color: colors.muted, fontSize: 8, margin: "8px 0 0" }}>
          {amountInWords(data.totalPaise)}
        </p>
      </section>

      <section style={{ marginTop: 22 }}>
        <h2
          style={{
            color: colors.muted,
            fontSize: 8,
            letterSpacing: 0.4,
            margin: "0 0 6px",
            textTransform: "uppercase",
          }}
        >
          Narration
        </h2>
        <p style={{ margin: 0 }}>{data.narration ?? "—"}</p>
      </section>
    </main>
  );
}
