# Import source: TallyPrime versus Zoho Books India, 2026-10-02

Evidence behind the [accounting core](../specs/accounting-core.md#slices)
slice 7 source decision (7d). Web research only; no live Tally or Zoho
organization was available. Accly's contract is slice 7: masters, a balanced
trial balance and bill-wise claims and credits, committed all or nothing.
Product behaviour below is documentation- and source-backed, not a captured
export. **UNVERIFIED** marks a claim not established; **INFERENCE** marks an
engineering or accounting conclusion rather than a vendor promise.

## 1. TallyPrime

### Answer: native XML is the useful export; a split is not inherently required

TallyPrime has a native **Alt+E > Masters > Configure > Export closing balance as opening balance** option. Tally's financial-year guide explicitly says to enter the **closing balance date**, then export XML; its FAQ says this option works **only in XML**, not Excel. Thus the premise that masters can export only original books-beginning openings is false. Ordinary `OPENINGBALANCE` and deliberately converted cutover closing `OPENINGBALANCE` must be distinguished by the user's export procedure, not the tag name. [T1][T2][T3][T6]

| Required information                     | No-plugin export / evidence                                                                                                                                                             | Important limitation                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group tree and ledgers with parent group | Export **All Masters** (accounting + inventory) as XML; accounting masters include Group/Ledger; their `PARENT` identifies hierarchy. [T1][T4][G1]                                      | Traverse parents, including custom subgroups; do not classify from a ledger's immediate parent string alone. Recommendation grounded in the documented group tree. [T5][G1]                                                                                                 |
| Ledger balance at cutover                | Enable **Export closing balance as opening balance**, enter closing date D. Alternatively export detailed **Trial Balance** as at D and use its closing Dr/Cr columns. [T1][T2][T3][Z1] | Without that setting, master opening means beginning-of-books, not D. Computed `ClosingBalance` can also be fetched over XML/TDL; it is date-context dependent, not a timeless stored opening. [T4][T6][G2]                                                                 |
| Party invoice/bill opening references    | Ledger master has `BillAllocations`: `Name`, `BillDate`, `OpeningBalance`, `BillCreditPeriod`, `IsAdvance` in the loader's explicit source schema. [G1]                                 | These are **master opening allocations**, not proof of every currently outstanding invoice in a normal unsplit company. Native conversion's exact propagation of cutover outstanding allocations/dates/advance flags is **UNVERIFIED** in the pages inspected. [G1][T1][T2] |
| Cutover-date bill-wise outstanding       | Native Receivables/Payables/Ledger/Group Outstandings reports expose party, reference, pending amount, due date, ageing; native report export exists. [T7][T1]                          | Configure all outstanding bills, not only overdue; compare with party ledger balances. Exact machine XML schema of these report exports is **UNVERIFIED**. [T7]                                                                                                             |
| Party tax/contact fields                 | Ledger master fields listed below, using official sample XML and loader source. [T4][G1]                                                                                                | History/multiple registrations require effective-date selection; 'last' is not necessarily cutover-effective. Recommendation based on the loader's `LedGSTRegDetails[Last]` fallback. [G1]                                                                                  |
| Stock-item master data                   | Native inventory/all masters; `Name`, `BaseUnits`, GST detail history, opening quantity/rate/value and standard-price lists in source. [T1][T4][G1]                                     | Inventory valuation rate is **not** necessarily a selling price. No universal income account per item is established by these exports. [G1][Z1]                                                                                                                             |

#### Closing date and Split Company / new-year alternative

Define **D = last legacy day included in balances**, **S = first new-business day, D+1**. Tally's split procedure creates a company **from S** and/or another **before S**; its financial-year guide says ledger balances carry forward automatically. For a 1-Apr-2026 start, legacy closing is 31-Mar-2026; split from 1-Apr-2026. Do not split on 31-Mar and call those openings the 31-Mar closing. [T3][T8][Z1]

Native split steps: finalize/backup books; resolve forex gains/losses and pending inventory/tax issues; **Alt+Y > Split > Verify Data**, correct errors, then **Split Data**, set **Split from S**; in 6.0+ choose **From Split Date** (or Into Two Companies), select the new child company, export **All Masters as XML**. Releases 5.1 and earlier use the older two-child workflow linked from the current page. Original company remains unchanged. Admin rights are required. [T8][T9]

Creating a new company and importing native **closing-as-opening XML** is another documented Tally new-year procedure, without splitting. Changing F2 period alone continues the old company and is **not evidence** that stored master openings were replaced. [T3]

**UNVERIFIED / important:** documentation does not promise lossless mid-year split retention of YTD revenue ledgers in the exact format Accly needs. New-year balances and prior profit carry-forward must not be confused with a mid-year YTD trial balance. Preserve the original as-at-D trial balance as authority and reconcile child/conversion exports to it; never assume a split is a free mid-year conversion. [T3][T8][T10]

### Ledger XML element structure and fields

The following is a **synthesized structural illustration**, not a captured export or an exhaustive schema. The envelope/TALLYMESSAGE/LEDGER/PARENT structure and address fields are documented by Tally; the bill/PAN/GST-history field spellings are grounded in the loader schema. The `LEDGER NAME` attribute occurs in Tally's alteration example; native full-master export wrapping can differ from collection-export responses. Do not require only one wrapper or assume every optional field exists. [T4][T11][G1]

```xml
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA>
    <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>
    <REQUESTDATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <LEDGER NAME="Customer ABC" ACTION="Create">
          <PARENT>Sundry Debtors</PARENT>
          <OPENINGBALANCE>-8000.00</OPENINGBALANCE>
          <ADDRESS.LIST TYPE="String">
            <ADDRESS>First address line</ADDRESS>
            <ADDRESS>Second address line</ADDRESS>
          </ADDRESS.LIST>
          <COUNTRYNAME>India</COUNTRYNAME>
          <LEDSTATENAME>Maharashtra</LEDSTATENAME>
          <PINCODE>400001</PINCODE>
          <EMAIL>accounts@example.com</EMAIL>
          <LEDGERPHONE>02212345678</LEDGERPHONE>
          <LEDGERMOBILE>9876543210</LEDGERMOBILE>
          <INCOMETAXNUMBER>ABCDE1234F</INCOMETAXNUMBER>
          <PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN>
          <BILLALLOCATIONS.LIST>
            <NAME>INV-88</NAME>
            <BILLDATE>20260210</BILLDATE>
            <OPENINGBALANCE>-10000.00</OPENINGBALANCE>
            <BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD>
            <ISADVANCE>No</ISADVANCE>
          </BILLALLOCATIONS.LIST>
          <BILLALLOCATIONS.LIST>
            <NAME>ADV-3</NAME>
            <BILLDATE>20260301</BILLDATE>
            <OPENINGBALANCE>2000.00</OPENINGBALANCE>
            <ISADVANCE>Yes</ISADVANCE>
          </BILLALLOCATIONS.LIST>
        </LEDGER>
      </TALLYMESSAGE>
    </REQUESTDATA>
  </IMPORTDATA></BODY>
</ENVELOPE>
```

- **GSTIN:** legacy/direct `PARTYGSTIN`; newer/history fallback `LEDGSTREGDETAILS.LIST` with child `GSTIN` and registration type. Loader explicitly uses `$PartyGSTIN` or `$LedGSTRegDetails[Last].GSTIN`. The exact release boundary, native XML child order and effective-date child spelling are **UNVERIFIED**; don't assert that the direct field always exists. [G1]
- **PAN:** `INCOMETAXNUMBER`; **state:** `LEDSTATENAME`; **address:** repeated `ADDRESS` under `ADDRESS.LIST`; **PIN:** `PINCODE`; **email:** `EMAIL` (also `EMAILCC`); **phone/mobile:** `LEDGERPHONE`, `LEDGERMOBILE` (country ISD separately in loader). Tally supplies mailing name in `MAILINGNAME.LIST`. [T4][G1]
- A separately normalized **city** is not established by these fields: address-line guessing is **UNVERIFIED**, not a reliable city extractor. Recommendation: retain full address and let users provide city when required. [T4][G1]
- Names/aliases: canonical name is not every `NAME` descendant; alias storage differs (loader uses `OnlyAlias`); language aliases are supported. Avoid treating aliases as additional masters. [G1][T12][T10]

### Party bills, advances, reference types, signs, and dates

`Ledger.BillAllocations` is explicitly the **opening allocation** collection. In contrast, transaction allocations occur under `Voucher.AllLedgerEntries.BillAllocations`, with `Amount` and `BillType`. This distinction is visible in the loader's separate master/transaction mappings. A voucher `<BILLTYPE>Advance</BILLTYPE>` must not be assumed to survive unchanged into a master allocation; the master flag observed in source is `IsAdvance`. The exact native exported shape for every Advance/On Account opening is **UNVERIFIED** until a real fixture is supplied. [G1]

Tally documents **New Ref** = create reference, **Against Ref / Agst Ref** = adjust existing reference, **On Account** = no specific bill link. Money received/paid before an invoice can be New Ref or On Account, so an importer must not classify all New Ref as invoices or all opposite-sign entries as GST advances. [T13] Historical `Advance` as a reference type is supported by community schema (`BillType`) but the current tracking page omits that label: release-specific enum behavior is **UNVERIFIED**, so inspect actual XML. [G1][T13]

For a normal customer/debtor: negative outstanding = Dr claim, positive unmatched receipt = Cr opening credit. For supplier/creditor: positive = Cr claim, negative unmatched payment = Dr opening credit. This classification is an **INFERENCE** from source signs and Accly's claim/credit contract, and it needs semantic review for credit notes/refunds/mixed-role parties. [T4][G2][T10]

**Amounts:** Tally accounting sign is **negative Debit, positive Credit**; official sales XML shows a negative debit to customer with `ISDEEMEDPOSITIVE=Yes`, and the loader documents the same convention. Do not assume IsDeemedPositive overrides the actual money sign or force liabilities positive: obverse balances are allowed. [T4][G2][T6]

**Dates:** official voucher XML uses `YYYYMMDD` such as `20160401`; static request date parameters may instead use `1-Apr-2008`. `BILLDATE` is typed as date in source; exact textual native `BILLDATE` representations across versions are **UNVERIFIED**, so fixture-test both date form and credit-period metadata. Do not confuse a credit period with an absolute due date; derive only with verified relative/absolute semantics. [T4][T11][G1]

**Reconciliation recommendation:** sum signed opening bill amounts plus any On Account residual must equal that party's cutover balance, then party totals must equal AR/AP controls. Never invent a historical invoice reference/date for non-billwise residuals. Tally's billwise-off/on-account behavior and Accly's required opening-item reference/date make the information gap real. [T7][T13][G1]; Accly contract `accounting-core.md:804-830,917-925`.

### Encoding

The native export screen distinguishes **Default (All Languages)** from **Restricted (ASCII)**. Official FAQ says restricted XML can replace Indian-language text and rupee symbol with question marks, so restricted export is lossy and unsuitable as a mandatory migration format. [T2]

Tally developer HTTP integrations support ASCII, UTF-8, UTF-16; do **not** infer disk-file encoding from the HTTP content type. **UNVERIFIED:** the precise universal default encoding of every TallyPrime 3/4/5 master-export disk file. UTF-16LE with BOM is a real supported artifact: inspecting two XML files in Tally's official developer ZIP gave leading `FF FE` and little-endian UTF-16 code units. Those are developer samples, not proof that every UI master export is UTF-16LE. Recommendation: detect BOM/XML declaration and accept UTF-16LE/BE and UTF-8; preserve Unicode, never blindly decode all uploads as UTF-8 or strip non-ASCII. [T14][T2][T15]

### Stock-item structure, HSN/GST and rate

Official stock master schema includes `STOCKITEM`, `NAME`, `BASEUNITS`. Loader source establishes `OpeningBalance` (quantity), `OpeningRate`, `OpeningValue`, `ClosingBalance/Rate/Value`, `StandardPriceList` and `StandardCostList`, each dated with `Rate`. [T4][G1]

GST history maps `StockItem.GstDetails.StateWiseDetails.RateDetails`: `ApplicableFrom`, `HSNCode`, `GSTRateDutyHead`, `GSTRate`, `GSTRatePerUnit`, `GSTRateValuationType`, reverse-charge flag and taxability. A structural XML spelling is `GSTDETAILS.LIST > STATEWISEDETAILS.LIST > RATEDETAILS.LIST`. **UNVERIFIED:** exact full native serialized shape/version and newer HSN-specific history layouts. Computed convenience methods `InfGSTHSNCode`, `InfGSTIGSTRate` in the loader are not evidence that those names appear verbatim in disk master exports. [G1]

**Recommendation:** select effective HSN/GST/standard-selling-price at D; full GST rate is typically IGST or CGST+SGST, not the sum of IGST+CGST+SGST. Preserve nil/exempt/non-GST distinctions; do not conflate zero rate. Treat opening valuation rate separately from sale price; when no dated selling price exists, Accly allows unit price zero and user income-account mapping. Compound/alternate units, price tiers, godowns/batches and per-unit cess need explicit user mapping or refusal, not silently discarded semantics. This is an **INFERENCE** from exported fields and Accly item requirements. [G1][Z1]; Accly contract `accounting-core.md:874-878`.

### The 28 predefined groups

The official current TallyPrime page confirms **15 primary + 13 subgroups**, nine balance-sheet primary groups and six revenue primary groups. The following table's group list/parents and accounting description are source-backed. `IsRevenue` is inferred directly from the documented revenue vs capital classification; `AffectsGrossProfit` reflects documented direct vs indirect classification. **UNVERIFIED:** exact Boolean defaults for every reserved group in a real exported file (especially balance-sheet groups, Branch/Divisions and Suspense); actual exported flags win over this reference table. Capital/Reserves are Tally liability-nature, but should map to **Equity** in Accly. [T5][T16][G1]

| Group                    | Parent              | Tally nature / Accly mapping note                                          | IsRevenue | AffectsGrossProfit (reference expectation) |
| ------------------------ | ------------------- | -------------------------------------------------------------------------- | --------- | ------------------------------------------ |
| Branch/Divisions         | Primary             | Balance-sheet; Assets/Liabilities **UNVERIFIED**, review intercompany side | No        | No                                         |
| Capital Account          | Primary             | Liabilities; Accly Equity                                                  | No        | No                                         |
| Current Assets           | Primary             | Assets                                                                     | No        | No                                         |
| Current Liabilities      | Primary             | Liabilities                                                                | No        | No                                         |
| Direct Expenses          | Primary             | Expenses                                                                   | Yes       | Yes                                        |
| Direct Incomes           | Primary             | Income                                                                     | Yes       | Yes                                        |
| Fixed Assets             | Primary             | Assets                                                                     | No        | No                                         |
| Indirect Expenses        | Primary             | Expenses                                                                   | Yes       | No                                         |
| Indirect Incomes         | Primary             | Income                                                                     | Yes       | No                                         |
| Investments              | Primary             | Assets                                                                     | No        | No                                         |
| Loans (Liability)        | Primary             | Liabilities                                                                | No        | No                                         |
| Misc. Expenses (ASSET)   | Primary             | Assets, not current expense                                                | No        | No                                         |
| Purchase Accounts        | Primary             | Expenses / purchases                                                       | Yes       | Yes (INFERENCE)                            |
| Sales Accounts           | Primary             | Income                                                                     | Yes       | Yes (INFERENCE)                            |
| Suspense A/c             | Primary             | Balance-sheet; Assets/Liabilities **UNVERIFIED**, accountant review        | No        | No                                         |
| Bank Accounts            | Current Assets      | Assets                                                                     | No        | No                                         |
| Bank OD A/c              | Loans (Liability)   | Liabilities                                                                | No        | No                                         |
| Cash-in-hand             | Current Assets      | Assets                                                                     | No        | No                                         |
| Deposits (Asset)         | Current Assets      | Assets                                                                     | No        | No                                         |
| Duties & Taxes           | Current Liabilities | Liabilities by group, can have asset/Dr balances                           | No        | No                                         |
| Loans & Advances (Asset) | Current Assets      | Assets, non-trade advances                                                 | No        | No                                         |
| Provisions               | Current Liabilities | Liabilities                                                                | No        | No                                         |
| Reserves & Surplus       | Capital Account     | Liabilities; Accly Equity                                                  | No        | No                                         |
| Secured Loans            | Loans (Liability)   | Liabilities                                                                | No        | No                                         |
| Stock-in-hand            | Current Assets      | Assets                                                                     | No        | No                                         |
| Sundry Creditors         | Current Liabilities | Liabilities, supplier default                                              | No        | No                                         |
| Sundry Debtors           | Current Assets      | Assets, customer default                                                   | No        | No                                         |
| Unsecured Loans          | Loans (Liability)   | Liabilities                                                                | No        | No                                         |

Sundry Debtors/Creditors give useful default customer/supplier classification, **not exclusive roles**. Tally expressly permits the same party ledger in sales and purchase transactions regardless of its debtor/creditor group, and Branch/Divisions can also be trading parties. Net balance alone loses simultaneous receivable/payable exposures. [T10][T5]

### Excel export and releases 3/4/5

Native master-to-Excel export exists: FAQ explicitly describes export masters to Excel and reimport selected rows, including stock groups/items. Excel import of masters/transactions was introduced in **4.0**; don't misdescribe that as the introduction of Excel export. [T6][T17]

**UNVERIFIED:** a release-pinned 3.0, 4.0 and 5.0 native master-export workbook fixture and its exact bill/GST nested columns. Existing legacy docs already describe multiple export formats, but current docs alone do not certify identical columns in each release. XML is the reliable choice **for this cutover contract** because closing-as-opening is explicitly XML-only and XML represents nested lists; this is not a claim that Excel is defective or unusable for CA-reviewed flat master data. [T2][T6][T17][G1]

## 2. Zoho Books India

### Exports and what they do / do not establish

| Export                            | Verified capability                                                                                                                                                                                   | Cutover caveat                                                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chart of Accounts                 | Accountant > Chart of Accounts > More > Export; CSV/XLS/XLSX, export template selects fields. [Z2]                                                                                                    | Hierarchical subtotals must not become additional posting rows; use expanded account detail for TB. [Z3]                                                                                                                                                    |
| Contacts (customers/vendors)      | Contacts have opening balance; native module export via More and custom export template. Migration doc explicitly supports opening balances in contact import files. [Z4][Z5][Z1]                     | **UNVERIFIED:** the exact India Contacts CSV opening-balance column and whether every export template includes it. Contact opening is not automatically a historical cutover balance; API exposes openings separately from outstanding/unused credits. [Z7] |
| Items                             | Native module export CSV/XLS/XLSX; item migration fields include sales/purchase rate + account, opening stock/rate/inventory account. [Z4][Z1]                                                        | Verify template includes HSN/GST/unit/account fields; don't assume current item rate equals historical D rate. [Z4][Z1]                                                                                                                                     |
| Invoices / Bills                  | Native module export supports status, date range, custom columns and CSV/XLS/XLSX. [Z4]                                                                                                               | Transaction date filter limits documents; it does not establish historical remaining balance after later settlements. **UNVERIFIED:** API/module export `balance` accepts an as-at date. [Z8][Z9]                                                           |
| Trial Balance report              | Reports > Accountant > Trial Balance documented; expanded/collapsed subaccount views documented, reports can be exported. [Z3][Z6]                                                                    | PDF report export verified; **UNVERIFIED:** exact current India TB CSV/XLSX field layout from live UI. Prefer accrual, as-at D, account-level Dr/Cr and exclude subtotal double counting. [Z3][Z6]                                                          |
| Receivable bill-wise at D         | Aging Details supports **As of** period/custom date, Date, Transaction#, Customer, Amount, **Balance Due**; **Export As** documented. Invoice Details also includes due dates/pending balances. [Z10] | A report can include credit notes/manual journals; configure and map explicitly. Exported due-date availability in the Aging Details chosen template should be checked; use invoice-detail join if needed. [Z10]                                            |
| Payable bill-wise at D            | Zoho's first-party FAQ identifies AP Aging Details as individual unpaid-bill view. [Z11]                                                                                                              | India payables help currently documents only Vendor Balance Summary and Purchase Order by Item. **UNVERIFIED:** the India plan/UI AP Aging Details as-at/export controls and exact columns; not inferred from Zoho Spend/Procurement docs. [Z12][Z11]       |
| Unmatched advances / credits at D | API contacts unused credits + unused retainer payments; payment and credit modules available. [Z7]                                                                                                    | **UNVERIFIED:** one native historical export captures all unused customer and supplier money, including retainer payments and credit adjustments. Current unused-credit balance is not proof of historical state at D. [Z7][Z8][Z9]                         |

Native module export is capped at **first 25,000 rows**; larger datasets need full backup. Export requires choosing PII inclusion when contact fields are sensitive. Both can otherwise silently make a migration dataset incomplete. [Z4]

### API availability

Zoho Books exposes REST API v3 for organizations, chart of accounts, contacts, items, invoices, bills, payments, credit notes, vendor credits and related operations. OAuth 2.0, `organization_id`, pagination, regional data-center endpoint and per-plan limits apply. India data center uses `https://www.zohoapis.in/books/v3`; don't substitute `.com` for an Indian-hosted account. [Z13]

Contacts API distinguishes `opening_balances[].opening_balance_amount`, `outstanding_receivable_amount(_bcy)` and `unused_credits_receivable_amount(_bcy)`, plus contact-opening-balances and unused-credit endpoints. Invoice/bill details contain balance/date/due-date and APIs can enumerate payment/credit applications. A date filter on document list is **not a documented historical-balance operator**. **UNVERIFIED:** a supported public organization-wide TB/AR/AP historical report endpoint was not found in the public API docs inspected; do not base a first importer on an undocumented `/reports/*` URL. [Z7][Z8][Z9][Z13]

**Conclusion:** Zoho has exportable date-based receivable detail, so 'Zoho cannot export bill-wise outstanding' is false. But a complete historical cutover including AP and unmatched money still needs actual exported samples or a ledger/application reconstruction; one Contacts+Invoices CSV combination is not established as sufficient. [Z10][Z11][Z12][Z7]

## 3. Market: Indian SMEs and CAs

**Recommendation-driving inference:** Tally is the more common incumbent among broad Indian SMEs and their traditional CA practices; Zoho is a credible growing cloud segment, not an insignificant competitor. Exact current comparative 2026 share is **UNVERIFIED**. Evidence is directional, not a common-denominator audited survey. [M1][M2][M3][M4]

- **Primary vendor statement:** Tally says over **2.7 million businesses across India and the Middle East** on its solution hub. This is neither India-only nor SME-only nor a percentage. [M1]
- **Primary vendor professional ecosystem statement:** Tally says nearly 2.5 million businesses worldwide, 7 million users, over 200,000 accounting/tax professionals in over 100 countries; it specifically describes long association with Indian CAs/ICAI. Those global counts do not prove an Indian CA market percentage. [M2]
- **Secondary corroboration, explicitly dated:** Business India, 22-Mar-2021, reports over 80% India market share and quotes Kerala CA firm Kumar & Sudhakaran's long-term operational usage. Its denominator/methodology is not supplied; do not re-label this as measured 2026 share. [M3]
- **Zoho primary speaker via reporting:** Zoho finance product head told BusinessLine (13-Dec-2024) India surpassed US new revenue in 2022 and is a leading Finance Suite market; this is revenue growth/geography across a suite, **not India Books customer count or Tally-relative share**. [M4]
- **UNVERIFIED:** no reliable recent India-only Tally-vs-Zoho-Books SME/CA adoption survey was located. Vendor marketing '8 out of 10 businesses' should not be read as 80% of all registered Indian MSMEs. [M1][M3]

## 4. Recommendation, minimum steps and pitfalls

### Support TallyPrime XML first — with report-backed reconciliation

**Recommendation / INFERENCE:** choose **TallyPrime native XML** first because the incumbent market direction and one native structured masters export fit the required fields better than assembling many independent Zoho CSVs/API calls. Keep source compatibility separate from the atomic Accly workbook contract. Do not promise 'any Tally file, one click' or require a plugin. [T1][T2][G1][M1][M2]; Accly contract `accounting-core.md:791-944`.

**Smallest documented native master/balance procedure:**

1. CA agrees D (last legacy day), finalizes/reconciles and backs up books; fixes forex/pending tax/inventory issues. [T8]
2. In original company **Alt+E > Masters > Configure**, choose **All Masters**, include dependent masters where necessary, XML and **Default (All Languages)**; enable **Export closing balance as opening**, set closing date **D**, export. No split is needed for this documented balance conversion. [T1][T2][T3]
3. Export detailed Trial Balance as at D and full bill-wise Receivables/Payables/party outstanding reports with bill dates, due dates and remaining amounts; export stock summary where inventory value must reconcile. These are checks and a source for any missing opening allocations. [T7][T1][Z1]
4. Accly maps groups/accounts, resolves party roles, confirms prices/taxes and any exceptions; signed bill items tie to each ledger, totals tie to AR/AP and TB balances. Only then check/commit atomically. **Recommendation**, not observed existing implementation. [G1][T5][T10]; Accly contract `accounting-core.md:874-944`.

**Alternative for verified master-opening files:** backup/verify → split from **S = D+1** → open the **from-S child** → Export All Masters XML → reconcile to original D reports. Use at new financial year if CA wants carry-forward; don't claim mid-year YTD correctness without proof. [T3][T8][T9][T10]

**Not yet proven minimal one-file procedure:** 'Export closing-as-opening All Masters XML' or 'Split then All Masters XML' captures ledger balances, but exact preservation of residual bill dates, partial settlements, Advance flags and On Account balances is **UNVERIFIED**. A real representative export must establish this before removing report uploads/reconciliation. [T1][T2][G1][T9]

### Pitfall checklist (source-grounded; importer response is recommendation)

| Pitfall                              | Evidence and consequence / recommended treatment                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Negative = Dr                        | Reverse sign into Accly debit-positive conventions; don't parse '-' as invalid money or liability normal side as sign. [T4][G2]                                                                                                                                                                         |
| Unicode / encoding                   | Preserve Default(All Languages); BOM-detect UTF-16/UTF-8. Restricted ASCII can destroy names/rupee characters; exact version defaults UNVERIFIED. [T2][T14][T15]                                                                                                                                        |
| Wrong closing vs opening date        | Plain master openings are beginning-of-books; use closing conversion at D or child opening from D+1. Never infer date from tag alone. [T3][T6][T8]                                                                                                                                                      |
| Multi-currency                       | Native export may carry currency symbols; forex balances/gains need adjustment. Reject foreign-currency amounts without verified base-INR value/exchange handling, not naive punctuation stripping. [T1][T8][G1]                                                                                        |
| Cost centres / categories            | Native masters exist, but split FAQ says cost-centre balances don't carry forward; Accly's workbook has no dimensional opening columns. Declare loss of dimensions and require accountant approval, don't invent dimension carry-forward. [T9][G1]; contract `accounting-core.md:870-878`.              |
| Profit & Loss A/c                    | Reserved ledger under Primary with prior profit/loss opening, separate from six revenue groups. Map accumulated profit to equity/retained earnings; reconcile without both carrying YTD revenue and double-counting current profit. [T10][T5]                                                           |
| Mid-year YTD revenue                 | New-year carry-forward is not evidence that split preserves every mid-year revenue balance. Original as-at TB remains authority; Accly requires YTD income/expense leaves on mid-year cutover. [T3][T8]; contract `accounting-core.md:899-905`.                                                         |
| Branch/Divisions                     | May be trading/intercompany parties, not ordinary new divisions/organizations. Determine party vs account and AR/AP side with CA. [T5][T16]                                                                                                                                                             |
| Suspense A/c                         | Balance-sheet holding account, not expense just because label mentions suspense. Preserve explicit account and ask CA nature; never force it into income/expense. [T5]                                                                                                                                  |
| Stock-in-hand                        | Integrated stock derived from item inventory; non-integrated stock manually maintained in ledger. Items opening-value and TB inventory must not be posted twice. Accly Items has no quantity opening contract; account-value opening must be explicit. [T5][G1]; contract `accounting-core.md:874-878`. |
| GST duty ledgers                     | Duties & Taxes includes GST/tax liabilities and debit tax assets. Map legacy tax balances to CA-named ordinary leaves, not Accly GST system accounts; Accly expressly refuses those opening lines. [T5]; contract `accounting-core.md:897-905`.                                                         |
| GST advances vs opening credits      | Tally GST advance tax records and billwise unmatched money aren't interchangeable. Imported unmatched money becomes Accly openingCredit with affectsTax=false, not new advanceSupply/GST transaction. [T18][T13]; contract `accounting-core.md:804-830`.                                                |
| Bill-wise off parties                | No reliable legacy bill references/dates can be recovered from only net balance. Require CA-supplied items/supporting schedules; never fabricate a claim named 'Opening Balance'. [T7][T13]; contract `accounting-core.md:807-810,917-925`.                                                             |
| On Account                           | Not tied to an invoice; may include advances/adjustments. Reconcile residual and require meaningful reference/date if native master lacks them. [T13][G1]                                                                                                                                               |
| Agst Ref vs New Ref vs Advance       | Against = settlement, not new claim; New Ref can be advance; voucher BillType vs master IsAdvance differ. Exact Advance serialization after conversion UNVERIFIED. [T13][G1]                                                                                                                            |
| Partial settlements / later payments | Ordinary opening allocations aren't current outstanding; compute/report as at D, not original invoice total or today's balance. [G1][G2][T7]                                                                                                                                                            |
| Mixed customer/supplier party        | Group determines default, not exclusive role. Tally nets positions; source ledger's opposite-side amount can be supplier exposure rather than customer credit. Need bill semantics/user classification, not sign-only guessing. [T10][T7]                                                               |
| Duplicate ledger names               | Identical ledger names across groups are disallowed; differently named debtor/creditor ledgers for one legal party still occur. Same GSTIN can appear on multiple branch ledgers (Tally allows; Accly collision rules differ). [T16][T6]; contract `accounting-core.md:910-916`.                        |
| Aliases / language aliases           | Alternate lookup/print names aren't separate ledgers. Use canonical name + GUID identity where available; don't turn every name-list value into a master. [T12][G1][T4]                                                                                                                                 |
| Renamed predefined groups            | Tally discourages changes and split can fail if defaults renamed. Honor actual parent/nature flags; surface ambiguity rather than assume English literals identify every system group. [T5][T9][T12]                                                                                                    |
| Rate / HSN / GST history             | Effective-date selection; selling price vs stock valuation rate; group-inherited tax vs item explicit tax; exact computed-field-to-disk mapping UNVERIFIED. Require explicit mapping for missing income accounts and cess/exempt semantics. [G1][T4]                                                    |
| Units / batches / warehouses         | Compound/alternate unit conversion and opening batch valuation are exported but absent from Accly item-template contract. Disclose unsupported inventory semantics; never silently round quantity/rate as money. [G1]; contract `accounting-core.md:874-878`.                                           |
| Duplicated group totals / P&L totals | Import leaf balances once, not group subtotals plus ledgers; validate total Dr=Cr and AR/AP item invariants. Recommendation from hierarchical reporting and atomic import rules. [T5][Z3]; contract `accounting-core.md:917-925`.                                                                       |
| Missing / malformed data             | Optional blank PAN/GST/contact fields aren't invented; money/reference/date limits and account collisions must surface before commit. Tax identity isn't a universal dedup key in Tally. [T4][T6]; contract `accounting-core.md:880-925`.                                                               |

### What this research proves / does not prove; next falsification

Proves native plugin-free closing-as-opening XML exists with a user-selected date; Tally source exposes required master/bill fields; Zoho has native flat exports, historical AR detail and a public API. Does **not** certify a real 3/4/5 export or lossless one-file party outstanding conversion. [T1][T2][T3][G1][Z4][Z10][Z13]

**Next falsification / release gate (recommendation):** get anonymized native exports from a real Tally company at a year boundary and mid-year D: customer invoice partially paid before D and fully paid after D; supplier bill; unmatched Advance and On Account; one mixed-role party; billwise-off balance; Unicode alias; GST registration/rate change; integrated stock; forex. Compare original D TB and outstanding schedules with both closing-as-opening XML and split-child XML. Until this succeeds, retain the exact **UNVERIFIED** caveats above; do not turn illustrative XML into a claimed captured fixture. [T7][T8][T9][T13][G1]

### Sources

[T1]: https://help.tallysolutions.com/export-data-in-tally/ "Tally native exports and closing-as-opening setting"
[T2]: https://help.tallysolutions.com/export-data-faq/ "XML-only conversion; ASCII vs all-languages"
[T3]: https://tallysolutions.com/tally/moving-to-new-financial-year/ "Closing date, split and new-company procedures"
[T4]: https://help.tallysolutions.com/sample-xml/ "Official ledger/address/stock/voucher XML; sign/date examples"
[T5]: https://help.tallysolutions.com/ledgers-and-groups-in-tallyprime/ "Current predefined groups, stock integration, P&L and party groups"
[T6]: https://help.tallysolutions.com/import-data-faq/ "Master Excel exports, sign convention, names/GSTIN duplicates"
[T7]: https://help.tallysolutions.com/manage-receivables-outstanding-tally/ "Outstanding reports, bill-wise prerequisites and exports"
[T8]: https://help.tallysolutions.com/split-company-data-tally/ "Native split verification/date/currency checklist"
[T9]: https://help.tallysolutions.com/split-company-data-in-tallyprime-faq/ "Split rights, bill/cost-centre/stock limitations"
[T10]: https://help.tallysolutions.com/ledgers-in-tallyprime/ "Party both debtor and creditor, stock and predefined ledgers"
[T11]: https://help.tallysolutions.com/understanding-tally-xml-tags/ "XML envelope, date parameters and ClosingBalance methods"
[T12]: https://help.tallysolutions.com/groups-in-tallyprime/ "Group nature, gross-profit option and language aliases"
[T13]: https://help.tallysolutions.com/receivables-payables-tracking-methods/ "New Ref, Against Ref, On Account including advances"
[T14]: https://help.tallysolutions.com/pre-requisites-for-integrations/ "HTTP XML encodings"
[T15]: https://help.tallysolutions.com/wp-content/uploads/2025/07/Integration_Demo_Samples.zip "Official developer samples; inspected UTF-16LE files"
[T16]: https://help.tallysolutions.com/docs/te9rel66/Creating_Masters/Accounts_Info/Intro_Groups.htm "Legacy default groups, duplicate-party names, branch accounts"
[T17]: https://help.tallysolutions.com/release-notes-tallyprime-4/ "Excel import introduced in 4.0"
[T18]: https://help.tallysolutions.com/india-gst-advance-receipts-tally/ "GST advance tax treatment is separate"
[G1]: https://github.com/dhananjay1405/tally-database-loader/blob/6aae17d3eb4fe1124127f72e58ec965f66178c12/tally-export-config.yaml "Pinned loader source: group/ledger/stock and opening bill mappings"
[G2]: https://github.com/dhananjay1405/tally-database-loader/blob/6aae17d3eb4fe1124127f72e58ec965f66178c12/docs/data-structure.md "Pinned loader sign convention and closing balance computation"
[Z1]: https://www.zoho.com/in/books/help/migration/tally-to-zoho-books.html "Tally exports, closing date, contact/item/opening migration"
[Z2]: https://www.zoho.com/in/books/help/accountant/chart-of-accounts.html "CoA export formats and templates"
[Z3]: https://www.zoho.com/in/books/help/accountant/sub-accounts.html "Trial Balance navigation and expanded/condensed hierarchy"
[Z4]: https://www.zoho.com/in/books/help/import-export/export.html "Module exports, templates, formats and 25,000-row limit"
[Z5]: https://www.zoho.com/in/books/help/contacts/ "Customer/vendor opening balance and tax/contact fields"
[Z6]: https://www.zoho.com/in/books/help/reports/manage-reports.html "Report export, date filters, basis and permissions"
[Z7]: https://www.zoho.com/books/api/v3/contacts/ "Contact API openings, outstanding/unused credit and retainer methods"
[Z8]: https://www.zoho.com/books/api/v3/invoices/ "Invoice balances, dates, payments and credits"
[Z9]: https://www.zoho.com/books/api/v3/bills/ "Bill dates/balances and filters"
[Z10]: https://www.zoho.com/in/books/help/reports/receivables.html "Historical aging detail and Export As"
[Z11]: https://www.zoho.com/us/books/kb/reports/difference-between-the-ap-reports.html "AP Aging Details first-party FAQ (US edition, India caveat)"
[Z12]: https://www.zoho.com/in/books/help/reports/payables.html "Current India payables documentation limit"
[Z13]: https://www.zoho.com/books/api/v3/introduction/ "Public API catalog, data centers, organization and limits"
[M1]: https://tallysolutions.com/tallyprime-solution-hub/ "Vendor business footprint statement"
[M2]: https://tallysolutions.com/us/confluence/ "Vendor global professional footprint and India CA association"
[M3]: https://businessindia.co/magazine/corporate-report/how-tally-solutions-software-empowers-businesses "Dated secondary India market corroboration and CA usage testimony"
[M4]: https://www.thehindubusinessline.com/info-tech/india-surpasses-us-as-largest-market-for-zohos-finance-suite/article68977080.ece "Zoho product head on India finance-suite revenue growth"
