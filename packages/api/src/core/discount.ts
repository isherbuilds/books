import { divideHalfUp } from "./money";

/** Caller rejects discounts above the subtotal with DISCOUNT_EXCEEDS_SUBTOTAL. */
export function splitDiscount(valuesPaise: readonly bigint[], discountPaise: bigint): bigint[] {
  const subtotal = valuesPaise.reduce((sum, value) => sum + value, 0n);

  if (valuesPaise.some((value) => value < 0n) || discountPaise < 0n || discountPaise > subtotal) {
    throw new RangeError("Invalid discount or line value");
  }

  if (discountPaise === 0n) return valuesPaise.map(() => 0n);

  const shares = valuesPaise.map((value) => divideHalfUp(discountPaise * value, subtotal));
  const allocated = shares.reduce((sum, share) => sum + share, 0n);
  let largest = 0;

  for (let index = 1; index < valuesPaise.length; index++) {
    if (valuesPaise[index]! > valuesPaise[largest]!) largest = index;
  }

  // A half-up share can over-allocate on many small lines. Correct the largest
  // line first, then spill across the rest without making any line negative.
  let remainder = discountPaise - allocated;

  if (remainder === 0n) return shares;

  const order = [largest, ...valuesPaise.keys()].filter(
    (index, position) => position === 0 || index !== largest,
  );

  for (const index of order) {
    const room = remainder > 0n ? valuesPaise[index]! - shares[index]! : shares[index]!;

    const change =
      remainder > 0n
        ? remainder < room
          ? remainder
          : room
        : remainder > -room
          ? remainder
          : -room;

    shares[index] = shares[index]! + change;
    remainder -= change;

    if (remainder === 0n) break;
  }

  return shares;
}
