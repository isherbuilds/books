const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
] as const;

const THOUSAND = 1_000n;

const LAKH = 100_000n;

const CRORE = 10_000_000n;

function underHundred(value: bigint): string {
  if (value < 20n) {
    return ONES[Number(value)]!;
  }

  const tens = TENS[Number(value / 10n)]!;
  const ones = ONES[Number(value % 10n)]!;

  return ones ? `${tens}-${ones}` : tens;
}

function numberInWords(value: bigint): string {
  if (value < 100n) {
    return underHundred(value);
  }

  if (value < THOUSAND) {
    const remainder = value % 100n;
    const hundred = `${ONES[Number(value / 100n)]} Hundred`;

    return remainder === 0n ? hundred : `${hundred} ${underHundred(remainder)}`;
  }

  if (value < LAKH) {
    const remainder = value % THOUSAND;
    const thousands = `${numberInWords(value / THOUSAND)} Thousand`;

    return remainder === 0n ? thousands : `${thousands} ${numberInWords(remainder)}`;
  }

  if (value < CRORE) {
    const remainder = value % LAKH;
    const lakhs = `${numberInWords(value / LAKH)} Lakh`;

    return remainder === 0n ? lakhs : `${lakhs} ${numberInWords(remainder)}`;
  }

  const remainder = value % CRORE;
  const crores = `${numberInWords(value / CRORE)} Crore`;

  return remainder === 0n ? crores : `${crores} ${numberInWords(remainder)}`;
}

export function amountInWords(paise: bigint): string {
  if (paise < 0n) {
    throw new Error("Amount cannot be negative");
  }

  if (paise === 0n) {
    return "Rupees Zero Only";
  }

  const rupees = paise / 100n;
  const paiseRemainder = paise % 100n;
  const rupeeWords = rupees === 0n ? "Zero" : numberInWords(rupees);
  const paiseWords = paiseRemainder === 0n ? "" : ` and ${numberInWords(paiseRemainder)} Paise`;

  return `Rupees ${rupeeWords}${paiseWords} Only`;
}
