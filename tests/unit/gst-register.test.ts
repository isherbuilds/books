import { expect, test } from "bun:test";

import {
  buildInwardRegister,
  buildOutwardRegister,
  type RegisterLine,
} from "@accly/api/core/gst-register";

const base: RegisterLine = {
  documentId: "invoice-1",
  type: "invoice",
  number: "INV-1",
  documentDate: "2026-09-01",
  partyName: "Buyer",
  partyGstin: "GSTIN",
  placeOfSupplyStateCode: "27",
  intraState: true,
  documentTotalPaise: 11_800n,
  against: null,
  supplyClass: "taxable",
  rateBasisPoints: 1_800,
  hsnSac: "1001",
  taxablePaise: 10_000n,
  cgstPaise: 900n,
  sgstPaise: 900n,
  igstPaise: 0n,
  itcEligible: null,
};

test("outward groups B2B and B2CS, negates CDNR, and includes exempt receipts", () => {
  const result = buildOutwardRegister([
    base,
    {
      ...base,
      documentId: "invoice-2",
      number: "INV-2",
      partyGstin: null,
      taxablePaise: 1_000n,
      cgstPaise: 90n,
      sgstPaise: 90n,
    },
    {
      ...base,
      documentId: "invoice-3",
      number: "INV-3",
      partyGstin: null,
      taxablePaise: 2_000n,
      cgstPaise: 180n,
      sgstPaise: 180n,
    },
    {
      ...base,
      documentId: "note-1",
      type: "creditNote",
      number: "CN-1",
      documentDate: "2026-09-02",
      taxablePaise: 500n,
      cgstPaise: 45n,
      sgstPaise: 45n,
      against: { number: "INV-1", documentDate: "2026-09-01" },
    },
    {
      ...base,
      documentId: "receipt-1",
      type: "receipt",
      number: "REC-1",
      partyGstin: null,
      supplyClass: "exempt",
      rateBasisPoints: null,
      taxablePaise: 800n,
      cgstPaise: 0n,
      sgstPaise: 0n,
    },
    {
      ...base,
      documentId: "receipt-2",
      type: "receipt",
      supplyClass: "notASupply",
      rateBasisPoints: null,
      taxablePaise: 999n,
    },
  ]);

  expect(result.b2b).toHaveLength(1);
  expect(result.b2b[0]).toMatchObject({ documentId: "invoice-1", taxablePaise: 10_000n });
  expect(result.b2cs).toEqual([
    {
      placeOfSupplyStateCode: "27",
      rateBasisPoints: 1_800,
      taxablePaise: 3_000n,
      cgstPaise: 270n,
      sgstPaise: 270n,
      igstPaise: 0n,
    },
  ]);
  expect(result.cdnr[0]).toMatchObject({
    against: { number: "INV-1", documentDate: "2026-09-01" },
    documentTotalPaise: -11_800n,
    taxablePaise: -500n,
    cgstPaise: -45n,
  });
  expect(result.hsn[0]).toMatchObject({ hsnSac: "1001", taxablePaise: 12_500n });
  expect(result.exempt).toEqual([
    {
      supplyClass: "exempt",
      intraState: true,
      taxablePaise: 800n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 0n,
    },
  ]);
});

test("outward uses the stored supply type for the B2CL threshold", () => {
  const result = buildOutwardRegister([
    {
      ...base,
      documentId: "large-interstate",
      partyGstin: null,
      intraState: false,
      documentTotalPaise: 10_000_001n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 1_800n,
    },
    {
      ...base,
      documentId: "small-interstate",
      partyGstin: null,
      intraState: false,
      documentTotalPaise: 10_000_000n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 1_800n,
    },
  ]);

  expect(result.b2cl.map((row) => row.documentId)).toEqual(["large-interstate"]);
  expect(result.b2cs).toEqual([
    {
      placeOfSupplyStateCode: "27",
      rateBasisPoints: 1_800,
      taxablePaise: 10_000n,
      cgstPaise: 0n,
      sgstPaise: 0n,
      igstPaise: 1_800n,
    },
  ]);
});

test("inward groups document rates and splits eligible and ineligible tax", () => {
  const result = buildInwardRegister([
    { ...base, type: "bill", documentId: "bill-1", number: "BILL-1", itcEligible: true },
    {
      ...base,
      type: "bill",
      documentId: "bill-1",
      number: "BILL-1",
      taxablePaise: 2_000n,
      cgstPaise: 180n,
      sgstPaise: 180n,
      itcEligible: false,
    },
    {
      ...base,
      type: "debitNote",
      documentId: "debit-1",
      number: "DN-1",
      documentDate: "2026-09-02",
      taxablePaise: 1_000n,
      cgstPaise: 90n,
      sgstPaise: 90n,
      itcEligible: true,
    },
  ]);

  expect(result.documents.map(({ number }) => number)).toEqual(["BILL-1", "DN-1"]);
  expect(result.documents[0]).toMatchObject({
    taxablePaise: 12_000n,
    eligibleTaxPaise: 1_800n,
    ineligibleTaxPaise: 360n,
  });
  expect(result.documents[1]).toMatchObject({
    taxablePaise: -1_000n,
    eligibleTaxPaise: -180n,
    ineligibleTaxPaise: 0n,
  });
});
