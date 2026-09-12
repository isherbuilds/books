import { formatDecimal, parseMoney } from "@accly/api/core/money";
import { computeInvoiceLines } from "@accly/api/lib/invoice-math";

export type WalkInQuote = {
  currency: string;
  lines: Array<{
    chargeId: string;
    source: "consultation" | "service";
    description: string;
    category: string;
    qty: number;
    unitPrice: string;
    taxRatePercent: string;
    taxCode: string | null;
    gross: string;
  }>;
  subtotal: string;
  discountAmount: string;
  taxTotal: string;
  grandTotal: string;
};

type LineMetadata = Pick<WalkInQuote["lines"][number], "category" | "source">;

function attachLineMetadata<T extends object>(
  lines: T[],
  sources: readonly LineMetadata[],
  missingSourceMessage: string,
): Array<T & LineMetadata> {
  return lines.map((line, index) => {
    const source = sources[index];

    if (!source) throw new Error(missingSourceMessage);

    return { ...line, category: source.category, source: source.source };
  });
}

export function applyDiscount(quote: WalkInQuote, discountAmount: string): WalkInQuote {
  const computed = computeInvoiceLines(
    quote.lines.map((line) => ({
      chargeId: line.chargeId,
      description: line.description,
      qty: line.qty,
      unitPrice: parseMoney(line.unitPrice),
      taxRatePercent: line.taxRatePercent,
      taxCode: line.taxCode,
    })),
    parseMoney(discountAmount),
  );

  return {
    ...quote,
    lines: attachLineMetadata(
      computed.lines.map((line) => ({
        ...line,
        unitPrice: formatDecimal(line.unitPrice),
        lineSubtotal: formatDecimal(line.lineSubtotal),
        allocatedDiscount: formatDecimal(line.allocatedDiscount),
        taxableValue: formatDecimal(line.taxableValue),
        taxAmount: formatDecimal(line.taxAmount),
        gross: formatDecimal(line.gross),
      })),
      quote.lines,
      "Discounted line has no quoted line",
    ),
    subtotal: formatDecimal(computed.subtotal),
    discountAmount,
    taxTotal: formatDecimal(computed.taxTotal),
    grandTotal: formatDecimal(computed.grandTotal),
  };
}

type PreviewService = {
  itemId: string;
  name: string;
  category: string;
  unitPrice: string;
  taxRatePercent: string;
  qty: number;
};

export function servicePreview(services: PreviewService[], currency: string): WalkInQuote {
  const previewLines = services.map((service) => ({
    chargeId: service.itemId,
    description: service.name,
    category: service.category,
    source: "service" as const,
    qty: service.qty,
    unitPrice: parseMoney(service.unitPrice),
    taxRatePercent: service.taxRatePercent,
    taxCode: null,
  }));

  const computed = computeInvoiceLines(previewLines, 0n);

  return {
    currency,
    lines: attachLineMetadata(
      computed.lines.map((line) => ({
        ...line,
        unitPrice: formatDecimal(line.unitPrice),
        lineSubtotal: formatDecimal(line.lineSubtotal),
        allocatedDiscount: formatDecimal(line.allocatedDiscount),
        taxableValue: formatDecimal(line.taxableValue),
        taxAmount: formatDecimal(line.taxAmount),
        gross: formatDecimal(line.gross),
      })),
      previewLines,
      "Computed preview line has no source line",
    ),
    subtotal: formatDecimal(computed.subtotal),
    discountAmount: "0.00",
    taxTotal: formatDecimal(computed.taxTotal),
    grandTotal: formatDecimal(computed.grandTotal),
  };
}
