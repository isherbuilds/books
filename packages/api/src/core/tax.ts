import { divideHalfUp } from "./money";

type TaxLineInput = { taxablePaise: bigint; rateBasisPoints: number | null };

/** Call 6: the stored print class includes mixed supplies and unregistered suppliers. */
export function invoicePrintTitle(printClass: "taxInvoice" | "billOfSupply") {
  return printClass === "taxInvoice" ? "Tax Invoice" : "Bill of Supply";
}

/**
 * GST for each line and the document. Each line takes the growth of the running
 * total rounded half-up, so the lines sum to the document total rounded once.
 */
export function computeTax(args: { intraState: boolean; lines: readonly TaxLineInput[] }) {
  // CGST and SGST are each half the rate: dividing by twice the basis serves both and
  // keeps an odd rate exact.
  const denominator = args.intraState ? 20_000n : 10_000n;

  const split = (amountPaise: bigint) =>
    args.intraState
      ? { cgstPaise: amountPaise, sgstPaise: amountPaise, igstPaise: 0n }
      : { cgstPaise: 0n, sgstPaise: 0n, igstPaise: amountPaise };

  let exact = 0n;
  let total = 0n;

  const lines = args.lines.map((line) => {
    exact += line.taxablePaise * BigInt(line.rateBasisPoints ?? 0);

    const next = divideHalfUp(exact, denominator);
    const amountPaise = next - total;
    total = next;

    return split(amountPaise);
  });

  return { lines, ...split(total) };
}

export function roundOff(grossPaise: bigint): bigint {
  return divideHalfUp(grossPaise, 100n) * 100n - grossPaise;
}

type TaxedLine = { amountPaise: bigint; cgstPaise: bigint; sgstPaise: bigint; igstPaise: bigint };

/** A document's taxable value and GST components, from its lines. */
export function taxTotals(lines: readonly TaxedLine[]) {
  const totals = { taxablePaise: 0n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n };

  for (const line of lines) {
    totals.taxablePaise += line.amountPaise;
    totals.cgstPaise += line.cgstPaise;
    totals.sgstPaise += line.sgstPaise;
    totals.igstPaise += line.igstPaise;
  }

  return totals;
}

/** A document's taxable value, taxes, round-off and total, from its lines. */
export function documentTotals(lines: readonly TaxedLine[]) {
  const taxes = taxTotals(lines);
  const grossPaise = taxes.taxablePaise + taxes.cgstPaise + taxes.sgstPaise + taxes.igstPaise;
  const roundOffPaise = roundOff(grossPaise);

  return { ...taxes, roundOffPaise, totalPaise: grossPaise + roundOffPaise };
}
