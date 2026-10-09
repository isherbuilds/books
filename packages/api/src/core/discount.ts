import { divideHalfUp, sumPaise } from "./money";

/** Caller rejects discounts above the subtotal with DISCOUNT_EXCEEDS_SUBTOTAL. */
export function splitDiscount(valuesPaise: readonly bigint[], discountPaise: bigint): bigint[] {
  const subtotal = sumPaise(valuesPaise);

  if (valuesPaise.some((value) => value < 0n) || discountPaise < 0n || discountPaise > subtotal) {
    throw new RangeError("Invalid discount or line value");
  }

  if (discountPaise === 0n) return valuesPaise.map(() => 0n);

  const shares = valuesPaise.map((value) => divideHalfUp(discountPaise * value, subtotal));
  const allocated = sumPaise(shares);
  let largest = 0;
  let largestPaise = -1n;

  for (const [index, value] of valuesPaise.entries()) {
    if (value > largestPaise) {
      largest = index;
      largestPaise = value;
    }
  }

  // A half-up share can over-allocate on many small lines. Correct the largest
  // line first, then spill across the rest without making any line negative.
  let remainder = discountPaise - allocated;

  if (remainder === 0n) return shares;

  const order = [largest, ...valuesPaise.keys()].filter(
    (index, position) => position === 0 || index !== largest,
  );

  for (const index of order) {
    const value = valuesPaise[index];
    const share = shares[index];

    if (value === undefined || share === undefined) throw new RangeError("Line index out of range");

    const room = remainder > 0n ? value - share : share;

    const change =
      remainder > 0n
        ? remainder < room
          ? remainder
          : room
        : remainder > -room
          ? remainder
          : -room;

    shares[index] = share + change;
    remainder -= change;

    if (remainder === 0n) break;
  }

  return shares;
}
