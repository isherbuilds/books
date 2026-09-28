import { businessDate } from "@accly/api/lib/business-date";
import { financialYearOf } from "@accly/api/core/numbering";
import { env } from "@accly/env/server";
import pg from "pg";

// The volume the query-performance measurements use: one large trader, far past a
// typical client. A second large organization measured the same plans, so only
// Meridian is filled; the others keep their base and demo seeds.
const ORGANIZATIONS = [{ slug: "meridian-traders", key: "meridian", target: 1_000_000 }] as const;

const DOCUMENT_TYPES = [
  "invoice",
  "receipt",
  "bill",
  "creditNote",
  "debitNote",
  "payment",
] as const;

type DocumentType = (typeof DOCUMENT_TYPES)[number];

const TYPE_CYCLE: Record<DocumentType, number> = {
  invoice: 7,
  receipt: 4,
  bill: 4,
  creditNote: 1,
  debitNote: 1,
  payment: 3,
};

const DOCUMENTS_PER_CYCLE = 20;

const BATCH_DOCUMENTS = 200_000;

const PREFIX = "MV";

const DAY_MS = 86_400_000;

type OrganizationRow = {
  id: string;
  legal_name: string;
  address: string;
  city: string;
  pin_code: string;
  pan: string;
  gstin: string | null;
  state_code: string;
  financial_year_start: number;
  time_zone: string;
  locked_through: string | null;
  tax_locked_through: string | null;
  user_id: string;
};

type AccountRow = {
  id: string;
  code: string;
  type: string;
  system_key: string | null;
  supply_class: string | null;
};

type OrganizationPlan = {
  id: string;
  slug: string;
  key: string;
  target: number;
  ownerId: string;
  settings: OrganizationRow;
  customers: string[];
  vendors: string[];
  methodId: string;
  methodAccountId: string;
  receivablesId: string;
  payablesId: string;
  customerAdvancesId: string;
  supplierAdvancesId: string;
  incomeAccountId: string;
  purchaseAccountId: string;
  paymentExpenseId: string;
  itemId: string;
  itemHsnSac: string | null;
  itemUnit: string | null;
};

function assertLocalDevelopmentDatabase(): void {
  const url = new URL(env.DATABASE_URL);
  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (
    env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    url.port !== "55446" ||
    url.pathname !== "/postgres"
  ) {
    throw new Error(
      "Refusing mega seeding outside the local development database at localhost:55446/postgres.",
    );
  }
}

/**
 * A UUIDv7-shaped document id, as the app writes: its first 48 bits are the document
 * date in milliseconds plus the row's index, so newest-first `id` order is date and
 * number order, as in production. The random bits come from `seed`.
 */
function documentIdSql(seed: string, date: string, index: string): string {
  const hash = `md5(${seed})`;
  const time = `lpad(to_hex((extract(epoch from ${date}) * 1000)::bigint + ${index}), 12, '0')`;
  const variant = `substr('89ab', ((strpos('0123456789abcdef', substr(${hash}, 17, 1)) - 1) % 4) + 1, 1)`;

  return `(substr(${time}, 1, 8) || '-' || substr(${time}, 9, 4) || '-7' || substr(${hash}, 14, 3) || '-' || ${variant} || substr(${hash}, 18, 3) || '-' || substr(${hash}, 21, 12))::uuid::text`;
}

function uuidSql(seed: string): string {
  const hash = `md5(${seed})`;
  const variant = `substr('89ab', ((strpos('0123456789abcdef', substr(${hash}, 17, 1)) - 1) % 4) + 1, 1)`;

  const formatted = [
    `substr(${hash}, 1, 8)`,
    `'-'`,
    `substr(${hash}, 9, 4)`,
    `'-4'`,
    `substr(${hash}, 14, 3)`,
    `'-'`,
    variant,
    `substr(${hash}, 18, 3)`,
    `'-'`,
    `substr(${hash}, 21, 12)`,
  ].join(" || ");

  return `(${formatted})::uuid::text`;
}

function expectedCounts(documentCount: number): Record<DocumentType, number> {
  const fullCycles = Math.floor(documentCount / DOCUMENTS_PER_CYCLE);
  const remaining = documentCount % DOCUMENTS_PER_CYCLE;

  const counts: Record<DocumentType, number> = {
    invoice: fullCycles * TYPE_CYCLE.invoice,
    receipt: fullCycles * TYPE_CYCLE.receipt,
    bill: fullCycles * TYPE_CYCLE.bill,
    creditNote: fullCycles * TYPE_CYCLE.creditNote,
    debitNote: fullCycles * TYPE_CYCLE.debitNote,
    payment: fullCycles * TYPE_CYCLE.payment,
  };

  for (let position = 0; position < remaining; position += 1) {
    const type =
      position < 7
        ? "invoice"
        : position < 11
          ? "receipt"
          : position < 15
            ? "bill"
            : position === 15
              ? "creditNote"
              : position === 16
                ? "debitNote"
                : "payment";

    counts[type] += 1;
  }

  return counts;
}

function currentFinancialYearStart(startMonth: number, financialYear: string): string {
  const startYear = Number(financialYear.slice(0, 4));

  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

async function createMegaItem(client: pg.Client, organizationId: string, incomeAccountId: string) {
  const [existing] = (
    await client.query<{
      id: string;
      hsn_sac: string | null;
      unit: string | null;
      income_account_id: string;
      tax_code: string | null;
    }>(
      `select id, hsn_sac, unit, income_account_id, tax_code
       from items
       where org_id = $1 and normalized_name = 'mega volume item'
       limit 1`,
      [organizationId],
    )
  ).rows;

  if (existing) {
    if (existing.income_account_id !== incomeAccountId || existing.tax_code !== null) {
      throw new Error("Mega Volume Item must use the selected non-taxable income account.");
    }

    return existing;
  }

  const [created] = (
    await client.query<{ id: string; hsn_sac: string | null; unit: string | null }>(
      `insert into items (
         id, org_id, name, normalized_name, hsn_sac, unit, unit_price_paise,
         mrp_paise, income_account_id, tax_code
       ) values ($1, $2, 'Mega Volume Item', 'mega volume item', null, 'unit', 1000000, null, $3, null)
       returning id, hsn_sac, unit`,
      [Bun.randomUUIDv7(), organizationId, incomeAccountId],
    )
  ).rows;

  if (!created) throw new Error("Mega Volume Item insert returned no row");

  return created;
}

async function loadOrganization(
  client: pg.Client,
  entry: (typeof ORGANIZATIONS)[number],
): Promise<OrganizationPlan> {
  const [organization] = (
    await client.query<OrganizationRow>(
      `select o.id, s.legal_name, s.address, s.city, s.pin_code, s.pan, s.gstin,
              s.state_code, s.financial_year_start, s.time_zone, s.locked_through,
              s.tax_locked_through, m.user_id
       from organization o
       join organization_settings s on s.org_id = o.id
       join member m on m.organization_id = o.id and m.role = 'owner'
       where o.slug = $1
       order by m.created_at
       limit 1`,
      [entry.slug],
    )
  ).rows;

  if (!organization) {
    throw new Error(
      `Missing ${entry.slug}. Run bun run db:seed first; it also seeds Cedar Components.`,
    );
  }

  if (organization.locked_through || organization.tax_locked_through) {
    throw new Error(
      `${entry.slug} has an accounting lock. Clear the locks before loading synthetic history.`,
    );
  }

  const accountRows = (
    await client.query<AccountRow>(
      `select id, code, type, system_key, supply_class
       from accounts
       where org_id = $1 and active = true`,
      [organization.id],
    )
  ).rows;

  const findSystemAccount = (key: string) => accountRows.find((row) => row.system_key === key)?.id;
  const receivablesId = findSystemAccount("receivables");
  const payablesId = findSystemAccount("payables");
  const customerAdvancesId = findSystemAccount("customerAdvances");
  const supplierAdvancesId = findSystemAccount("supplierAdvances");

  const purchaseAccountId = accountRows.find(
    (row) => row.code === "6010" && row.type === "expense" && row.system_key === null,
  )?.id;

  const paymentExpenseId =
    accountRows.find(
      (row) => row.code === "6030" && row.type === "expense" && row.system_key === null,
    )?.id ??
    accountRows.find(
      (row) => row.code === "6020" && row.type === "expense" && row.system_key === null,
    )?.id;

  const incomeAccount = organization.gstin
    ? accountRows.find(
        (row) => row.type === "income" && row.system_key === null && row.supply_class === "exempt",
      )
    : accountRows.find(
        (row) => row.code === "5010" && row.type === "income" && row.system_key === null,
      );

  if (
    !receivablesId ||
    !payablesId ||
    !customerAdvancesId ||
    !supplierAdvancesId ||
    !purchaseAccountId ||
    !paymentExpenseId ||
    !incomeAccount
  ) {
    throw new Error(
      `${entry.slug} is missing a required posting account in its chart of accounts.`,
    );
  }

  const [method] = (
    await client.query<{ id: string; account_id: string }>(
      `select pm.id, pm.account_id
       from payment_methods pm
       join accounts a on a.org_id = pm.org_id and a.id = pm.account_id and a.active = true
       where pm.org_id = $1 and pm.active = true
       order by (pm.name = 'Bank transfer') desc, pm.name
       limit 1`,
      [organization.id],
    )
  ).rows;

  if (!method)
    throw new Error(`${entry.slug} has no active payment method with an active account.`);

  const [customers, vendors] = await Promise.all([
    client.query<{ id: string }>(
      `select id from parties where org_id = $1 and active = true and roles @> array['customer']::text[] order by id`,
      [organization.id],
    ),
    client.query<{ id: string }>(
      `select id from parties where org_id = $1 and active = true and roles @> array['vendor']::text[] order by id`,
      [organization.id],
    ),
  ]);

  if (customers.rows.length === 0 || vendors.rows.length === 0) {
    throw new Error(
      `${entry.slug} needs at least one active customer and one active vendor party.`,
    );
  }

  const item = await createMegaItem(client, organization.id, incomeAccount.id);

  return {
    id: organization.id,
    slug: entry.slug,
    key: entry.key,
    target: entry.target,
    ownerId: organization.user_id,
    settings: organization,
    customers: customers.rows.map(({ id }) => id),
    vendors: vendors.rows.map(({ id }) => id),
    methodId: method.id,
    methodAccountId: method.account_id,
    receivablesId,
    payablesId,
    customerAdvancesId,
    supplierAdvancesId,
    incomeAccountId: incomeAccount.id,
    purchaseAccountId,
    paymentExpenseId,
    itemId: item.id,
    itemHsnSac: item.hsn_sac,
    itemUnit: item.unit,
  };
}

async function generatedDocumentCount(
  client: pg.Client,
  plan: OrganizationPlan,
  financialYear: string,
) {
  const series = (
    await client.query<{ document_type: DocumentType; next: number; financial_year: string }>(
      `select document_type, next, financial_year
       from number_series
       where org_id = $1 and prefix = $2 and document_type = any($3::text[])`,
      [plan.id, PREFIX, DOCUMENT_TYPES],
    )
  ).rows;

  if (series.some((row) => row.financial_year !== financialYear)) {
    throw new Error(
      `${plan.slug} has a mega-volume series from another financial year. Run the local volume cleanup before starting a new yearly fixture.`,
    );
  }

  const found: Record<DocumentType, number> = {
    invoice: 0,
    receipt: 0,
    bill: 0,
    creditNote: 0,
    debitNote: 0,
    payment: 0,
  };

  for (const row of series) found[row.document_type] = row.next - 1;

  const total = Object.values(found).reduce((sum, value) => sum + value, 0);
  const expected = expectedCounts(total);

  if (DOCUMENT_TYPES.some((type) => found[type] !== expected[type])) {
    throw new Error(
      `${plan.slug} has an incomplete or edited mega-volume series. Stop before adding more rows.`,
    );
  }

  return total;
}

async function insertBatch(
  client: pg.Client,
  plan: OrganizationPlan,
  financialYear: string,
  financialYearShort: string,
  startDate: string,
  dateSpanDays: number,
  totalCycles: number,
  startIndex: number,
  endIndex: number,
  endCount: number,
  today: string,
): Promise<void> {
  const orgSnapshot = {
    legalName: plan.settings.legal_name,
    address: [plan.settings.address, [plan.settings.city, plan.settings.pin_code].join(" ")]
      .filter(Boolean)
      .join(", "),
    gstin: plan.settings.gstin,
    pan: plan.settings.pan,
  };

  await client.query("begin");

  try {
    await client.query(
      `insert into mega_volume_batch (
         global_index, cycle, cycle_position, document_type, type_sequence,
         id, party_id, target_document_id, cancelled, document_date,
         total_paise, settlement_kind, advance_supply, exposure_side, payment_method_id
       )
       with raw as (
         select n as global_index,
                ((n - 1) / 20)::bigint as cycle,
                ((n - 1) % 20)::integer as cycle_position
         from generate_series($1::bigint, $2::bigint) as rows(n)
       ), typed as (
         select *,
                case
                  when cycle_position < 7 then 'invoice'
                  when cycle_position < 11 then 'receipt'
                  when cycle_position < 15 then 'bill'
                  when cycle_position = 15 then 'creditNote'
                  when cycle_position = 16 then 'debitNote'
                  else 'payment'
                end as document_type,
                case
                  when cycle_position < 7 then cycle * 7 + cycle_position + 1
                  when cycle_position < 11 then cycle * 4 + cycle_position - 6
                  when cycle_position < 15 then cycle * 4 + cycle_position - 10
                  when cycle_position < 17 then cycle + 1
                  else cycle * 3 + cycle_position - 16
                end as type_sequence
         from raw
       ), params as (
         select $3::text as org_key,
                $4::text[] as customers,
                $5::text[] as vendors,
                $6::text as method_id,
                $7::text as state_code,
                $8::date as first_date,
                $9::integer as date_span,
                $10::bigint as total_cycles
       ), dated as (
         -- Dates rise with the index across the year, so numbers follow dates.
         select t.*, p.*,
                p.first_date + ((t.cycle * p.date_span) / p.total_cycles)::integer as document_date
         from typed t cross join params p
       ), linked as (
         select t.*,
                case
                  when t.document_type = 'creditNote' then ${documentIdSql("t.org_key || ':invoice:' || (t.cycle * 7 + 1)::text", "t.document_date", "t.cycle * 20 + 1")}
                  when t.document_type = 'debitNote' then ${documentIdSql("t.org_key || ':bill:' || (t.cycle * 4 + 1)::text", "t.document_date", "t.cycle * 20 + 12")}
                  when t.document_type = 'receipt' and t.cycle_position in (7, 8) then ${documentIdSql("t.org_key || ':invoice:' || (t.cycle * 7 + 1)::text", "t.document_date", "t.cycle * 20 + 1")}
                  when t.document_type = 'receipt' and t.cycle_position = 9 then ${documentIdSql("t.org_key || ':invoice:' || (t.cycle * 7 + 2)::text", "t.document_date", "t.cycle * 20 + 2")}
                  when t.document_type = 'payment' and t.cycle_position in (17, 18) then ${documentIdSql("t.org_key || ':bill:' || (t.cycle * 4 + 1)::text", "t.document_date", "t.cycle * 20 + 12")}
                  else null
                end as target_document_id,
                case
                  when t.document_type = 'invoice' then t.customers[((t.cycle * 7 + t.cycle_position) % cardinality(t.customers))::integer + 1]
                  when t.document_type = 'creditNote' then t.customers[(t.cycle * 7 % cardinality(t.customers))::integer + 1]
                  when t.document_type = 'receipt' and t.cycle_position in (7, 8) then t.customers[(t.cycle * 7 % cardinality(t.customers))::integer + 1]
                  when t.document_type = 'receipt' and t.cycle_position = 9 then t.customers[((t.cycle * 7 + 1) % cardinality(t.customers))::integer + 1]
                  when t.document_type = 'bill' then t.vendors[((t.cycle * 4 + t.cycle_position - 11) % cardinality(t.vendors))::integer + 1]
                  when t.document_type = 'debitNote' then t.vendors[(t.cycle * 4 % cardinality(t.vendors))::integer + 1]
                  when t.document_type = 'payment' and t.cycle_position in (17, 18) then t.vendors[(t.cycle * 4 % cardinality(t.vendors))::integer + 1]
                  else null
                end as party_id
         from dated t
       )
       select global_index, cycle, cycle_position, document_type, type_sequence,
              ${documentIdSql("org_key || ':' || document_type || ':' || type_sequence::text", "document_date", "global_index")},
              party_id, target_document_id,
              cycle % 100 = 0 and (
                (document_type = 'invoice' and cycle_position = 6) or
                (document_type = 'bill' and cycle_position = 14) or
                (document_type in ('creditNote', 'debitNote') and cycle_position in (15, 16)) or
                (document_type = 'receipt' and cycle_position = 10) or
                (document_type = 'payment' and cycle_position = 19)
              ),
              document_date,
              case when document_type in ('creditNote', 'debitNote') then 100000::bigint else
                   case when document_type in ('receipt', 'payment') then 300000::bigint else 1000000::bigint end end,
              case when document_type = 'receipt' then
                     case when cycle_position = 9 then 'advance' when cycle_position = 10 then 'direct' else 'against' end
                   when document_type = 'payment' then
                     case when cycle_position = 18 then 'advance' when cycle_position = 19 then 'direct' else 'against' end
                   else null end,
              case when document_type = 'receipt' and cycle_position = 9 then 'goods' else null end,
              case when document_type in ('invoice', 'creditNote') then 'receivable'
                   when document_type in ('bill', 'debitNote') then 'payable'
                   when document_type = 'receipt' and cycle_position < 10 then 'receivable'
                   when document_type = 'payment' and cycle_position < 19 then 'payable'
                   else null end,
              case when document_type in ('receipt', 'payment') then method_id else null end
       from linked`,
      [
        startIndex,
        endIndex,
        plan.key,
        plan.customers,
        plan.vendors,
        plan.methodId,
        plan.settings.state_code,
        startDate,
        dateSpanDays,
        totalCycles,
      ],
    );

    const documentParams = [
      plan.id,
      financialYearShort,
      financialYear,
      JSON.stringify(orgSnapshot),
      plan.settings.gstin !== null,
      plan.settings.state_code,
      plan.ownerId,
    ];

    const documentSelect = `
      select b.id, $1, b.document_type,
             case when b.cancelled then 'cancelled' else 'posted' end,
             'MV' || $2 || '/' || b.type_sequence::text, $3,
             b.document_date,
             case when b.document_type in ('invoice', 'bill') then b.document_date + 30 else null end,
             case when b.document_type in ('invoice', 'bill', 'creditNote', 'debitNote') then p.state_code
                  when b.document_type = 'receipt' and b.cycle_position = 10 then $6
                  else null end,
             case when b.document_type in ('invoice', 'bill', 'creditNote', 'debitNote') then p.state_code = $6
                  when b.document_type = 'receipt' and b.cycle_position = 10 then true
                  else null end,
             b.party_id, case when b.document_type in ('creditNote', 'debitNote') then b.target_document_id else null end,
             b.exposure_side, b.settlement_kind, b.advance_supply, b.payment_method_id,
             'MEGA-VOLUME:' || b.document_type || ':' || b.type_sequence::text,
             'Mega volume dataset', 1, b.total_paise, 0, 0,
             $5::boolean and b.document_type in ('invoice', 'bill', 'creditNote', 'debitNote', 'receipt') and
               (b.document_type <> 'receipt' or b.cycle_position = 10),
             jsonb_build_object(
               'organization', $4::jsonb,
               'party', case when p.id is null then null else jsonb_build_object(
                 'name', p.name,
                 'address', concat_ws(', ', p.address, concat_ws(' ', p.city, p.pin_code)),
                 'stateCode', p.state_code,
                 'gstin', p.gstin,
                 'pan', p.pan
               ) end,
               'paymentMethod', pm.name,
               'lines', jsonb_build_array(jsonb_build_object('description',
                 case when b.document_type in ('invoice', 'creditNote') then 'Mega volume item'
                      when b.document_type in ('bill', 'debitNote') then 'Mega volume purchase'
                      when b.document_type = 'receipt' then 'Mega volume receipt'
                      else 'Mega volume payment' end
               ))
             ),
             now(), case when b.cancelled then now() else null end, $7
      from mega_volume_batch b
      left join parties p on p.org_id = $1 and p.id = b.party_id
      left join payment_methods pm on pm.org_id = $1 and pm.id = b.payment_method_id`;

    await client.query(
      `insert into documents (
         id, org_id, type, state, number, financial_year, document_date, due_date,
         place_of_supply_state_code, intra_state, party_id, against_document_id,
         exposure_side, settlement_kind, advance_supply, payment_method_id,
         reference, narration, version, total_paise, discount_paise, round_off_paise,
         affects_tax, print_snapshot, posted_at, cancelled_at, created_by
       ) ${documentSelect} where b.document_type not in ('creditNote', 'debitNote')`,
      documentParams,
    );
    await client.query(
      `insert into documents (
         id, org_id, type, state, number, financial_year, document_date, due_date,
         place_of_supply_state_code, intra_state, party_id, against_document_id,
         exposure_side, settlement_kind, advance_supply, payment_method_id,
         reference, narration, version, total_paise, discount_paise, round_off_paise,
         affects_tax, print_snapshot, posted_at, cancelled_at, created_by
       ) ${documentSelect} where b.document_type in ('creditNote', 'debitNote')`,
      documentParams,
    );

    const lineParams = [
      plan.id,
      plan.itemId,
      plan.incomeAccountId,
      plan.purchaseAccountId,
      plan.paymentExpenseId,
      plan.itemHsnSac,
      plan.itemUnit,
    ];

    const lineSelect = `
      select ${uuidSql("'document-line:' || b.id")}, $1, b.id,
             case when b.document_type in ('creditNote', 'debitNote') then
               ${uuidSql("'document-line:' || b.target_document_id")} else null end,
             1,
             case when b.document_type = 'invoice' then 'item' else 'account' end,
             case when b.document_type in ('invoice', 'creditNote') then $3
                  when b.document_type in ('bill', 'debitNote') then $4
                  when b.document_type = 'receipt' and b.cycle_position = 10 then $3
                  when b.document_type = 'payment' and b.cycle_position = 19 then $5
                  else null end,
             null, null,
             case when b.document_type = 'invoice' then $2 else null end,
             null,
             case when b.document_type in ('invoice', 'creditNote') then 'Mega volume item'
                  when b.document_type in ('bill', 'debitNote') then 'Mega volume purchase'
                  when b.document_type = 'receipt' then 'Mega volume receipt'
                  else 'Mega volume payment' end,
             case when b.document_type in ('invoice', 'creditNote') then $6 else null end,
             case when b.document_type = 'invoice' then $7 else null end,
             case when b.document_type = 'invoice' then 1 else null end,
             case when b.document_type = 'invoice' then b.total_paise else null end,
             null, null, null, 0, 0, 0, b.total_paise, 0
      from mega_volume_batch b`;

    await client.query(
      `insert into document_lines (
         id, org_id, document_id, source_line_id, position, kind, account_id,
         entry_side, adjustment_kind, item_id, party_id, description, hsn_sac,
         unit, quantity, unit_price_paise, mrp_paise, tax_rate_id, itc_eligible,
         cgst_paise, sgst_paise, igst_paise, amount_paise, discount_paise
       ) ${lineSelect} where b.document_type not in ('creditNote', 'debitNote')`,
      lineParams,
    );
    await client.query(
      `insert into document_lines (
         id, org_id, document_id, source_line_id, position, kind, account_id,
         entry_side, adjustment_kind, item_id, party_id, description, hsn_sac,
         unit, quantity, unit_price_paise, mrp_paise, tax_rate_id, itc_eligible,
         cgst_paise, sgst_paise, igst_paise, amount_paise, discount_paise
       ) ${lineSelect} where b.document_type in ('creditNote', 'debitNote')`,
      lineParams,
    );

    await client.query(
      `insert into journal_entries (
         id, org_id, document_type, document_id, kind, reverses_entry_id,
         entry_date, narration, created_by
       )
       select ${uuidSql("'journal-post:' || b.id")}, $1, b.document_type, b.id,
              'post', null, b.document_date, 'Mega volume dataset', $2
       from mega_volume_batch b`,
      [plan.id, plan.ownerId],
    );

    await client.query(
      `insert into journal_lines (id, org_id, entry_id, entry_date, account_id, party_id, debit, credit)
       select ${uuidSql("'journal-line-post:' || b.id || ':' || lines.line_number::text")},
              $1, e.id, e.entry_date, lines.account_id, lines.party_id, lines.debit, lines.credit
       from mega_volume_batch b
       join journal_entries e on e.org_id = $1 and e.document_id = b.id and e.kind = 'post'
       cross join lateral (values
         (1,
          case b.document_type
            when 'invoice' then $2 when 'bill' then $5 when 'creditNote' then $4
            when 'debitNote' then $3 when 'receipt' then $6
            when 'payment' then case b.settlement_kind when 'against' then $3 when 'advance' then $8 else $7 end end,
          case when b.document_type in ('invoice', 'debitNote') then b.party_id
               when b.document_type = 'payment' and b.settlement_kind in ('against', 'advance') then b.party_id
               else null end,
          b.total_paise, 0::bigint),
         (2,
          case b.document_type
            when 'invoice' then $4 when 'bill' then $3 when 'creditNote' then $2
            when 'debitNote' then $5
            when 'receipt' then case b.settlement_kind when 'against' then $2 when 'advance' then $9 else $4 end
            when 'payment' then $6 end,
          case when b.document_type in ('bill', 'creditNote') then b.party_id
               when b.document_type = 'receipt' and b.settlement_kind in ('against', 'advance') then b.party_id
               else null end,
          0::bigint, b.total_paise)
       ) as lines(line_number, account_id, party_id, debit, credit)`,
      [
        plan.id,
        plan.receivablesId,
        plan.payablesId,
        plan.incomeAccountId,
        plan.purchaseAccountId,
        plan.methodAccountId,
        plan.paymentExpenseId,
        plan.supplierAdvancesId,
        plan.customerAdvancesId,
      ],
    );

    await client.query(
      `insert into party_ledger_lines (
         id, org_id, party_id, document_id, side, kind, amount_paise, entry_date
       )
       select ${uuidSql("'party-ledger-post:' || b.id")}, $1, b.party_id, b.id,
              case when b.document_type in ('bill', 'debitNote', 'payment') then 'payable' else 'receivable' end,
              'post',
              case
                when b.document_type in ('bill', 'receipt', 'creditNote') then -b.total_paise
                else b.total_paise
              end,
              b.document_date
       from mega_volume_batch b
       where b.party_id is not null and (
         b.document_type in ('invoice', 'bill', 'creditNote', 'debitNote') or
         (b.document_type = 'receipt' and b.settlement_kind in ('against', 'advance')) or
         (b.document_type = 'payment' and b.settlement_kind in ('against', 'advance'))
       )`,
      [plan.id],
    );

    await client.query(
      `insert into allocations (
         id, org_id, source_document_id, target_document_id, amount_paise,
         kind, reverses_allocation_id, entry_date, created_by
       )
       select ${uuidSql("'allocation:' || b.id")}, $1, b.id, b.target_document_id,
              b.total_paise, 'apply', null, b.document_date, $2
       from mega_volume_batch b
       where b.target_document_id is not null`,
      [plan.id, plan.ownerId],
    );

    await client.query(
      `insert into journal_entries (
         id, org_id, document_type, document_id, kind, reverses_entry_id,
         entry_date, narration, created_by
       )
       select ${uuidSql("'journal-allocation:' || a.id")}, $1, 'allocation', a.id,
              'post', null, b.document_date, 'Advance applied to open item', $2
       from mega_volume_batch b
       join allocations a on a.org_id = $1 and a.source_document_id = b.id and a.kind = 'apply'
       where (b.document_type = 'receipt' and b.settlement_kind = 'advance') or
             (b.document_type = 'payment' and b.settlement_kind = 'advance')`,
      [plan.id, plan.ownerId],
    );

    await client.query(
      `insert into journal_lines (id, org_id, entry_id, entry_date, account_id, party_id, debit, credit)
       select ${uuidSql("'journal-line-allocation:' || a.id || ':' || lines.line_number::text")},
              $1, entry.id, entry.entry_date, lines.account_id, b.party_id, lines.debit, lines.credit
       from mega_volume_batch b
       join allocations a on a.org_id = $1 and a.source_document_id = b.id and a.kind = 'apply'
       join journal_entries entry on entry.org_id = $1 and entry.document_id = a.id and entry.document_type = 'allocation' and entry.kind = 'post'
       cross join lateral (values
         (1,
          case when b.document_type = 'receipt' then $2 else $3 end,
          b.total_paise, 0::bigint),
         (2,
          case when b.document_type = 'receipt' then $4 else $5 end,
          0::bigint, b.total_paise)
       ) as lines(line_number, account_id, debit, credit)
       where (b.document_type = 'receipt' and b.settlement_kind = 'advance') or
             (b.document_type = 'payment' and b.settlement_kind = 'advance')`,
      [
        plan.id,
        plan.customerAdvancesId,
        plan.payablesId,
        plan.receivablesId,
        plan.supplierAdvancesId,
      ],
    );

    await client.query(
      `insert into allocations (
         id, org_id, source_document_id, target_document_id, amount_paise,
         kind, reverses_allocation_id, entry_date, created_by
       )
       select ${uuidSql("'allocation-reverse:' || b.id")}, $1, applied.source_document_id,
              applied.target_document_id, applied.amount_paise, 'reverse', applied.id, $2, $3
       from mega_volume_batch b
       join allocations applied on applied.org_id = $1 and applied.source_document_id = b.id and applied.kind = 'apply'
       where b.cancelled and b.document_type in ('creditNote', 'debitNote')`,
      [plan.id, today, plan.ownerId],
    );

    await client.query(
      `insert into journal_entries (
         id, org_id, document_type, document_id, kind, reverses_entry_id,
         entry_date, narration, created_by
       )
       select ${uuidSql("'journal-reverse:' || b.id")}, $1, b.document_type, b.id,
              'reverse', post.id, $2, 'Cancelled mega volume document', $3
       from mega_volume_batch b
       join journal_entries post on post.org_id = $1 and post.document_id = b.id and post.kind = 'post'
       where b.cancelled`,
      [plan.id, today, plan.ownerId],
    );

    await client.query(
      `insert into journal_lines (id, org_id, entry_id, entry_date, account_id, party_id, debit, credit)
       select ${uuidSql("'journal-line-reverse:' || original.id")},
              $1, reverse.id, reverse.entry_date, original.account_id, original.party_id, original.credit, original.debit
       from mega_volume_batch b
       join journal_entries post on post.org_id = $1 and post.document_id = b.id and post.kind = 'post'
       join journal_lines original on original.org_id = $1 and original.entry_id = post.id
       join journal_entries reverse on reverse.org_id = $1 and reverse.reverses_entry_id = post.id
       where b.cancelled`,
      [plan.id],
    );

    await client.query(
      `insert into party_ledger_lines (
         id, org_id, party_id, document_id, side, kind, amount_paise, entry_date
       )
       select ${uuidSql("'party-ledger-reverse:' || b.id")}, $1, posted.party_id,
              b.id, posted.side, 'reverse', -posted.amount_paise, $2
       from mega_volume_batch b
       join party_ledger_lines posted on posted.org_id = $1 and posted.document_id = b.id and posted.kind = 'post'
       where b.cancelled`,
      [plan.id, today],
    );

    const counts = expectedCounts(endCount);
    await client.query(
      `insert into number_series (org_id, document_type, financial_year, prefix, next)
       select $1, rows.document_type, $2, $3, rows.count + 1
       from unnest($4::text[], $5::integer[]) as rows(document_type, count)
       on conflict (org_id, document_type, financial_year, prefix)
       do update set next = excluded.next`,
      [plan.id, financialYear, PREFIX, DOCUMENT_TYPES, DOCUMENT_TYPES.map((type) => counts[type])],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function seedOrganization(client: pg.Client, plan: OrganizationPlan, today: string) {
  const financialYear = financialYearOf(today, plan.settings.financial_year_start);
  const financialYearShort = financialYear.slice(2);

  const [databaseCount] = (
    await client.query<{ count: string }>(
      `select count(*)::text as count from documents where org_id = $1`,
      [plan.id],
    )
  ).rows;

  const generatedCount = await generatedDocumentCount(client, plan, financialYear);
  const existingCount = Number(databaseCount?.count ?? 0);

  if (generatedCount > existingCount) {
    throw new Error(`${plan.slug} has a mega-volume series without matching documents.`);
  }

  const baselineCount = existingCount - generatedCount;
  const generatedTarget = Math.max(0, plan.target - baselineCount);
  const target = Math.max(generatedTarget, generatedCount);

  if (existingCount >= plan.target && generatedCount === 0) {
    console.info(
      `${plan.slug}: already has ${existingCount.toLocaleString()} documents; target is ${plan.target.toLocaleString()}.`,
    );

    return;
  }

  const startDate = currentFinancialYearStart(plan.settings.financial_year_start, financialYear);

  const dateSpanDays =
    Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS) +
    1;

  if (dateSpanDays < 1) throw new Error(`${plan.slug} has an invalid financial-year date range.`);

  await client.query(`
    create temporary table if not exists mega_volume_batch (
      global_index bigint not null,
      cycle bigint not null,
      cycle_position integer not null,
      document_type text not null,
      type_sequence bigint not null,
      id text not null,
      party_id text,
      target_document_id text,
      cancelled boolean not null,
      document_date date not null,
      total_paise bigint not null,
      settlement_kind text,
      advance_supply text,
      exposure_side text,
      payment_method_id text
    ) on commit delete rows
  `);

  const startedAt = performance.now();
  let completed = generatedCount;

  while (completed < target) {
    const next = Math.min(target, completed + BATCH_DOCUMENTS);
    await insertBatch(
      client,
      plan,
      financialYear,
      financialYearShort,
      startDate,
      dateSpanDays,
      Math.ceil(target / DOCUMENTS_PER_CYCLE),
      completed + 1,
      next,
      next,
      today,
    );
    completed = next;

    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    console.info(
      `${plan.slug}: ${completed.toLocaleString()} / ${target.toLocaleString()} mega documents (${elapsedSeconds.toFixed(1)} s)`,
    );
  }

  const finalTotal = baselineCount + completed;
  const typeCounts = expectedCounts(completed);

  console.info(
    `${plan.slug}: ${finalTotal.toLocaleString()} total documents, ` +
      `${completed.toLocaleString()} generated, in ${((performance.now() - startedAt) / 1000).toFixed(1)} s.`,
  );
  console.info(
    `  Synthetic rows: ${DOCUMENT_TYPES.map((type) => `${type} ${typeCounts[type].toLocaleString()}`).join(", ")}`,
  );
}

async function main(): Promise<void> {
  assertLocalDevelopmentDatabase();

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("set synchronous_commit = off");
    // Each batch joins 200,000 rows against tables that grew since their last
    // ANALYZE. A stale estimate of one row picks a nested loop that rescans the
    // batch per row (25 minutes for one statement); hash joins stay linear.
    await client.query("set enable_nestloop = off");
    const plans: OrganizationPlan[] = [];

    for (const entry of ORGANIZATIONS) {
      plans.push(await loadOrganization(client, entry));
    }

    for (const plan of plans) {
      const today = businessDate(new Date(), plan.settings.time_zone);
      console.info(`\n${plan.slug}: target ${plan.target.toLocaleString()} total documents`);
      await seedOrganization(client, plan, today);
    }

    console.info("\nUpdating planner statistics for volume reads and reports…");
    await client.query(
      "analyze documents, document_lines, journal_entries, journal_lines, party_ledger_lines, allocations",
    );
    console.info("Mega volume seed complete.");
  } finally {
    await client.end();
  }
}

if (import.meta.main) await main();
