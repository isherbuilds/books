import { computeTax } from "./tax";

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

    const tax =
      partial[partialIndex]?.index === index
        ? calculated.lines[partialIndex++]!
        : {
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
