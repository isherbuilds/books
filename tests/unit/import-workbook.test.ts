import { expect, test } from "bun:test";

import { parseMoney } from "@accly/api/core/money";
import { readImportWorkbook, TEMPLATE_VERSION } from "@accly/api/lib/import-workbook";
import { writeXlsx } from "hucre/xlsx";

test("a number cell reads a large amount exactly and refuses a third decimal", async () => {
  const bytes = await writeXlsx({
    sheets: [
      { name: "Read me", rows: [["Instructions", TEMPLATE_VERSION]] },
      {
        name: "Trial balance",
        rows: [
          ["Account", "Debit", "Credit"],
          // Float noise passes a fixed 1e-6 tolerance from about ₹10 crore.
          ["Cash in Hand", 1234567890.09, null],
          ["Capital Account", null, 1.005],
          ["Capital Account", null, 600000000000.005],
        ],
      },
    ],
  });

  // SAFETY: writeXlsx allocates a Uint8Array backed by an ArrayBuffer.
  const { workbook, errors } = await readImportWorkbook(
    new File([bytes as Uint8Array<ArrayBuffer>], "import.xlsx"),
  );

  expect(workbook.trialBalance.map((row) => row.debitPaise)).toEqual([parseMoney("1234567890.09")]);
  expect(errors.map((error) => [error.row, error.code])).toEqual([
    [3, "AMOUNT_INVALID"],
    [4, "AMOUNT_INVALID"],
  ]);
});
