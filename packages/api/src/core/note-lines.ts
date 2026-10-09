import { divideHalfUp } from "./money";
import { computeTax } from "./tax";

/**
 * TDS a note reverses: the bill's TDS on the returned-to-date taxable value, rounded
 * half-up to a rupee, less what earlier notes reversed. Rounding the running total keeps
 * every note within half a rupee and makes a full return reverse exactly the bill's TDS.
 */
export function noteTdsReversal(args: {
  billTdsPaise: bigint;
  billTaxablePaise: bigint;
  priorTaxablePaise: bigint;
  priorReversedPaise: bigint;
  taxablePaise: bigint;
}): bigint {
  const { billTdsPaise, billTaxablePaise, priorTaxablePaise, priorReversedPaise, taxablePaise } =
    args;

  const returnedPaise = priorTaxablePaise + taxablePaise;

  if (billTaxablePaise <= 0n || taxablePaise < 0n || returnedPaise > billTaxablePaise)
    throw new Error("Note taxable value exceeds bill taxable value");

  if (priorReversedPaise > billTdsPaise) throw new Error("Prior note TDS exceeds bill TDS");

  const due =
    divideHalfUp(billTdsPaise * returnedPaise, billTaxablePaise * 100n) * 100n - priorReversedPaise;

  // A cancelled earlier note can leave the others a rupee ahead of the running total.
  return due > 0n ? due : 0n;
}

type Components = {
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
};

type NoteLine = {
  source: Components & { rateBasisPoints: number | null };
  prior: Components;
  amountPaise: bigint;
};

/** Full credits take the source's remaining tax; partial credits share one document-wide tax rounding. */
export function computeNoteLines(args: {
  intraState: boolean;
  lines: readonly NoteLine[];
}): { ok: true; lines: Components[] } | { ok: false; index: number } {
  const partial: { index: number; taxablePaise: bigint; rateBasisPoints: number | null }[] = [];

  for (const [index, line] of args.lines.entries()) {
    const remaining = line.source.taxablePaise - line.prior.taxablePaise;

    if (line.amountPaise < 0n || line.amountPaise > remaining) return { ok: false, index };

    if (line.amountPaise !== remaining) {
      partial.push({
        index,
        taxablePaise: line.amountPaise,
        rateBasisPoints: line.source.rateBasisPoints,
      });
    }
  }

  const calculated = computeTax({ intraState: args.intraState, lines: partial });
  const lines: Components[] = [];
  let partialIndex = 0;

  for (const [index, line] of args.lines.entries()) {
    const { source, prior, amountPaise } = line;

    const shared =
      partial[partialIndex]?.index === index ? calculated.lines[partialIndex++] : undefined;

    const tax = shared ?? {
      cgstPaise: source.cgstPaise - prior.cgstPaise,
      sgstPaise: source.sgstPaise - prior.sgstPaise,
      igstPaise: source.igstPaise - prior.igstPaise,
    };

    if (
      tax.cgstPaise < 0n ||
      prior.cgstPaise + tax.cgstPaise > source.cgstPaise ||
      tax.sgstPaise < 0n ||
      prior.sgstPaise + tax.sgstPaise > source.sgstPaise ||
      tax.igstPaise < 0n ||
      prior.igstPaise + tax.igstPaise > source.igstPaise
    ) {
      return { ok: false, index };
    }

    lines.push({ taxablePaise: amountPaise, ...tax });
  }

  return { ok: true, lines };
}
