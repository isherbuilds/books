export type RegisterLine = {
  documentId: string;
  type: "invoice" | "creditNote" | "bill" | "debitNote" | "receipt";
  number: string;
  documentDate: string;
  partyName: string | null;
  partyGstin: string | null;
  placeOfSupplyStateCode: string | null;
  intraState: boolean;
  documentTotalPaise: bigint;
  against: { number: string; documentDate: string } | null;
  supplyClass: "taxable" | "exempt" | "nil" | "nonGst" | "notASupply" | null;
  rateBasisPoints: number | null;
  hsnSac: string | null;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
  itcEligible: boolean | null;
};

type Amounts = Pick<RegisterLine, "taxablePaise" | "cgstPaise" | "sgstPaise" | "igstPaise">;

type DocumentRow = Pick<
  RegisterLine,
  | "documentId"
  | "number"
  | "documentDate"
  | "partyName"
  | "partyGstin"
  | "placeOfSupplyStateCode"
  | "documentTotalPaise"
  | "against"
  | "rateBasisPoints"
> &
  Amounts;

type SummaryRow = Pick<RegisterLine, "placeOfSupplyStateCode" | "rateBasisPoints"> & Amounts;

type HsnRow = { hsnSac: string; rateBasisPoints: number } & Amounts;

type ExemptRow = { supplyClass: "exempt" | "nil" | "nonGst"; intraState: boolean } & Amounts;

type InwardRow = DocumentRow & { eligibleTaxPaise: bigint; ineligibleTaxPaise: bigint };

function addAmounts(target: Amounts, line: RegisterLine, sign: bigint) {
  target.taxablePaise += sign * line.taxablePaise;
  target.cgstPaise += sign * line.cgstPaise;
  target.sgstPaise += sign * line.sgstPaise;
  target.igstPaise += sign * line.igstPaise;
}

function amounts(): Amounts {
  return { taxablePaise: 0n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n };
}

function documentRow(line: RegisterLine, sign: bigint): DocumentRow {
  const {
    documentId,
    number,
    documentDate,
    partyName,
    partyGstin,
    placeOfSupplyStateCode,
    against,
    rateBasisPoints,
  } = line;

  return {
    documentId,
    number,
    documentDate,
    partyName,
    partyGstin,
    placeOfSupplyStateCode,
    documentTotalPaise: sign * line.documentTotalPaise,
    against,
    rateBasisPoints,
    ...amounts(),
  };
}

function byDocument(a: DocumentRow, b: DocumentRow): number {
  return (
    a.documentDate.localeCompare(b.documentDate) ||
    a.number.localeCompare(b.number) ||
    a.documentId.localeCompare(b.documentId) ||
    (a.rateBasisPoints ?? 0) - (b.rateBasisPoints ?? 0)
  );
}

function keyedRows<T>(rows: Map<string, T>): T[] {
  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

export function buildOutwardRegister(lines: readonly RegisterLine[]) {
  const b2b = new Map<string, DocumentRow>();
  const b2cl = new Map<string, DocumentRow>();
  const b2cs = new Map<string, SummaryRow>();
  const cdnr = new Map<string, DocumentRow>();
  const cdnur = new Map<string, DocumentRow>();
  const hsn = new Map<string, HsnRow>();
  const exempt = new Map<string, ExemptRow>();

  for (const line of lines) {
    if (line.type !== "invoice" && line.type !== "creditNote" && line.type !== "receipt") continue;

    if (line.supplyClass === "notASupply") continue;
    const sign = line.type === "creditNote" ? -1n : 1n;
    const { intraState } = line;

    if (
      line.supplyClass === "nil" ||
      line.supplyClass === "exempt" ||
      line.supplyClass === "nonGst"
    ) {
      const key = JSON.stringify([line.supplyClass, intraState]);
      let row = exempt.get(key);

      if (!row) {
        row = { supplyClass: line.supplyClass, intraState, ...amounts() };
        exempt.set(key, row);
      }

      addAmounts(row, line, sign);
    }

    if (line.type === "receipt" || line.rateBasisPoints === null) continue;

    const documentKey = JSON.stringify([line.documentId, line.rateBasisPoints]);

    if (
      line.type === "invoice" &&
      !line.partyGstin &&
      (intraState || line.documentTotalPaise <= 10_000_000n)
    ) {
      const key = JSON.stringify([line.placeOfSupplyStateCode, line.rateBasisPoints]);
      let row = b2cs.get(key);

      if (!row) {
        row = {
          placeOfSupplyStateCode: line.placeOfSupplyStateCode,
          rateBasisPoints: line.rateBasisPoints,
          ...amounts(),
        };
        b2cs.set(key, row);
      }

      addAmounts(row, line, sign);
    } else {
      const table =
        line.type === "creditNote"
          ? line.partyGstin
            ? cdnr
            : cdnur
          : line.partyGstin
            ? b2b
            : b2cl;

      let row = table.get(documentKey);

      if (!row) {
        row = documentRow(line, sign);
        table.set(documentKey, row);
      }

      addAmounts(row, line, sign);
    }

    const hsnSac = line.hsnSac ?? "";
    const hsnKey = JSON.stringify([hsnSac, line.rateBasisPoints]);
    let hsnRow = hsn.get(hsnKey);

    if (!hsnRow) {
      hsnRow = { hsnSac, rateBasisPoints: line.rateBasisPoints, ...amounts() };
      hsn.set(hsnKey, hsnRow);
    }

    addAmounts(hsnRow, line, sign);
  }

  return {
    b2b: [...b2b.values()].sort(byDocument),
    b2cl: [...b2cl.values()].sort(byDocument),
    b2cs: keyedRows(b2cs),
    cdnr: [...cdnr.values()].sort(byDocument),
    cdnur: [...cdnur.values()].sort(byDocument),
    hsn: keyedRows(hsn),
    exempt: keyedRows(exempt),
  };
}

export function buildInwardRegister(lines: readonly RegisterLine[]) {
  const documents = new Map<string, InwardRow>();

  for (const line of lines) {
    if (line.type !== "bill" && line.type !== "debitNote") continue;
    const sign = line.type === "debitNote" ? -1n : 1n;
    const key = JSON.stringify([line.documentId, line.rateBasisPoints]);
    let row = documents.get(key);

    if (!row) {
      row = { ...documentRow(line, sign), eligibleTaxPaise: 0n, ineligibleTaxPaise: 0n };
      documents.set(key, row);
    }

    addAmounts(row, line, sign);
    const taxPaise = sign * (line.cgstPaise + line.sgstPaise + line.igstPaise);

    if (line.itcEligible) row.eligibleTaxPaise += taxPaise;
    else row.ineligibleTaxPaise += taxPaise;
  }

  return { documents: [...documents.values()].sort(byDocument) };
}
