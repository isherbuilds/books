import { divideHalfUp } from "./money";

type TaxLineInput = { taxablePaise: bigint; rateBasisPoints: number | null };

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
