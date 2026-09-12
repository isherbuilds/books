import type { DbTransaction } from "@accly/db/counter";
import { accounts, type AccountType, type SupplyClass } from "@accly/db/schema/accounts";
import type { LegalType } from "@accly/db/schema/organization-settings";

export const SYSTEM_ACCOUNT_KEYS = [
  "cash",
  "bank",
  "receivables",
  "payables",
  "cgstOutput",
  "sgstOutput",
  "igstOutput",
  "cessOutput",
  "cgstInput",
  "sgstInput",
  "igstInput",
  "cessInput",
  "tdsPayable",
  "tdsReceivable",
  "roundOff",
  "openingEquity",
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

type TemplateAccount = {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
  systemKey?: SystemAccountKey;
  supplyClass?: SupplyClass;
};

const coreAccounts = (equityName: string): TemplateAccount[] => [
  { code: "100", name: "Current Assets", type: "asset" },
  { code: "1000", name: "Cash in Hand", type: "asset", parentCode: "100", systemKey: "cash" },
  { code: "1100", name: "Bank", type: "asset", parentCode: "100", systemKey: "bank" },
  {
    code: "1300",
    name: "Accounts Receivable",
    type: "asset",
    parentCode: "100",
    systemKey: "receivables",
  },
  {
    code: "1400",
    name: "TDS Receivable",
    type: "asset",
    parentCode: "100",
    systemKey: "tdsReceivable",
  },
  {
    code: "1510",
    name: "CGST Input Credit",
    type: "asset",
    parentCode: "100",
    systemKey: "cgstInput",
  },
  {
    code: "1520",
    name: "SGST Input Credit",
    type: "asset",
    parentCode: "100",
    systemKey: "sgstInput",
  },
  {
    code: "1530",
    name: "IGST Input Credit",
    type: "asset",
    parentCode: "100",
    systemKey: "igstInput",
  },
  {
    code: "1540",
    name: "Cess Input Credit",
    type: "asset",
    parentCode: "100",
    systemKey: "cessInput",
  },
  { code: "200", name: "Current Liabilities", type: "liability" },
  {
    code: "2000",
    name: "Accounts Payable",
    type: "liability",
    parentCode: "200",
    systemKey: "payables",
  },
  {
    code: "2210",
    name: "CGST Output Payable",
    type: "liability",
    parentCode: "200",
    systemKey: "cgstOutput",
  },
  {
    code: "2220",
    name: "SGST Output Payable",
    type: "liability",
    parentCode: "200",
    systemKey: "sgstOutput",
  },
  {
    code: "2230",
    name: "IGST Output Payable",
    type: "liability",
    parentCode: "200",
    systemKey: "igstOutput",
  },
  {
    code: "2240",
    name: "Cess Output Payable",
    type: "liability",
    parentCode: "200",
    systemKey: "cessOutput",
  },
  {
    code: "2300",
    name: "TDS Payable",
    type: "liability",
    parentCode: "200",
    systemKey: "tdsPayable",
  },
  { code: "3000", name: equityName, type: "equity", systemKey: "openingEquity" },
  { code: "6900", name: "Round Off", type: "expense", systemKey: "roundOff" },
];

const professionalIncome: TemplateAccount[] = [
  { code: "5010", name: "Professional Fees", type: "income", supplyClass: "taxable" },
  { code: "5020", name: "Rent Received", type: "income", supplyClass: "exempt" },
  { code: "5030", name: "Interest Income", type: "income", supplyClass: "exempt" },
  { code: "6010", name: "Professional Expenses", type: "expense" },
  { code: "6020", name: "Rent and Utilities", type: "expense" },
];

const businessIncome: TemplateAccount[] = [
  { code: "5010", name: "Sales", type: "income", supplyClass: "taxable" },
  { code: "5020", name: "Service Income", type: "income", supplyClass: "taxable" },
  { code: "5030", name: "Interest Income", type: "income", supplyClass: "exempt" },
  { code: "6010", name: "Purchases", type: "expense" },
  { code: "6020", name: "Salaries", type: "expense" },
  { code: "6030", name: "Administrative Expenses", type: "expense" },
];

const institutionIncome: TemplateAccount[] = [
  { code: "5010", name: "Fees", type: "income", supplyClass: "taxable" },
  { code: "5020", name: "Donations", type: "income", supplyClass: "notASupply" },
  { code: "5030", name: "Grants", type: "income", supplyClass: "notASupply" },
  { code: "5040", name: "Interest Income", type: "income", supplyClass: "exempt" },
  { code: "6010", name: "Program Expenses", type: "expense" },
  { code: "6020", name: "Staff Costs", type: "expense" },
];

export const CHART_TEMPLATES: Record<LegalType, readonly TemplateAccount[]> = {
  individual: [...coreAccounts("Capital Account"), ...professionalIncome],
  proprietorship: [...coreAccounts("Capital Account"), ...professionalIncome],
  partnership: [...coreAccounts("Capital Account"), ...businessIncome],
  llp: [...coreAccounts("Capital Account"), ...businessIncome],
  company: [...coreAccounts("Share Capital"), ...businessIncome],
  trust: [...coreAccounts("Corpus Fund"), ...institutionIncome],
  society: [...coreAccounts("General Fund"), ...institutionIncome],
};

export async function seedChartOfAccounts(
  tx: DbTransaction,
  orgId: string,
  legalType: LegalType,
): Promise<void> {
  const template = CHART_TEMPLATES[legalType];
  const idsByCode = new Map(template.map((account) => [account.code, Bun.randomUUIDv7()]));

  await tx.insert(accounts).values(
    template.map((account) => {
      const parentId = account.parentCode ? idsByCode.get(account.parentCode) : undefined;

      if (account.parentCode && !parentId) {
        throw new Error(`Unknown parent account code "${account.parentCode}"`);
      }

      return {
        id: idsByCode.get(account.code)!,
        orgId,
        code: account.code,
        name: account.name,
        type: account.type,
        parentId: parentId ?? null,
        systemKey: account.systemKey ?? null,
        supplyClass: account.supplyClass ?? null,
        active: true,
      };
    }),
  );
}
