import { amountInWords } from "@accly/api/core/amount-in-words";
import { formatMoney } from "@accly/api/core/money";
import type { PrintSnapshot } from "@accly/db/schema/documents";
import type { CSSProperties, ReactNode } from "react";

// The pieces every printed document shares: one palette, header, stamp and total panel.

export const colors = {
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

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
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

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        color: colors.muted,
        fontSize: 8,
        letterSpacing: 0.4,
        margin: "0 0 6px",
        textTransform: "uppercase",
      }}
    >
      {children}
    </h2>
  );
}

/** The page: the organization's letterhead, the document's kind and number, and a stamp if cancelled. */
export function PrintedDocument({
  organization,
  kind,
  number,
  cancelled,
  children,
}: {
  organization: PrintSnapshot["organization"];
  kind: string;
  number: string;
  cancelled: boolean;
  children: ReactNode;
}) {
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
          <p style={{ color: colors.muted, fontSize: 8, margin: "4px 0 0" }}>
            {[
              organization.address,
              organization.gstin ? `GSTIN ${organization.gstin}` : "",
              `PAN ${organization.pan}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{kind}</div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{number}</div>
        </div>
      </header>

      {cancelled ? (
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

      {children}
    </main>
  );
}

/** The shaded panel that ends a document: its rows, then the amount and the amount in words. */
export function TotalPanel({
  label,
  amountPaise,
  children,
}: {
  label: string;
  amountPaise: bigint;
  children?: ReactNode;
}) {
  return (
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
      {children}
      <div
        style={{
          borderTop: children ? `1px solid ${colors.border}` : undefined,
          display: "flex",
          fontSize: 12,
          fontWeight: 700,
          justifyContent: "space-between",
          marginTop: children ? 6 : 0,
          paddingTop: children ? 8 : 0,
        }}
      >
        <span>{label}</span>
        <span style={{ color: colors.accent }}>{formatMoney(amountPaise)}</span>
      </div>
      <p style={{ color: colors.muted, fontSize: 8, margin: "8px 0 0" }}>
        {amountInWords(amountPaise)}
      </p>
    </section>
  );
}

/** One label and amount inside a total panel. */
export function TotalRow({ label, amountPaise }: { label: string; amountPaise: bigint }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
      <span>{label}</span>
      <span>{formatMoney(amountPaise)}</span>
    </div>
  );
}
