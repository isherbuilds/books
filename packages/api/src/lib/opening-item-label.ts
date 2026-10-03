// Dependency-free, so statements on the server and lists in the web share one label.

/** A payable claim is the vendor's bill; every other opening item reads by its type. */
export function openingItemLabel(
  type: "openingClaim" | "openingCredit",
  side: "receivable" | "payable" | null,
) {
  return type === "openingCredit"
    ? "Opening credit"
    : side === "payable"
      ? "Opening bill"
      : "Opening invoice";
}
