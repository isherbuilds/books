CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"parent_id" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_key" text,
	"supply_class" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('asset', 'liability', 'equity', 'income', 'expense')),
	CONSTRAINT "accounts_supply_class_check" CHECK ("accounts"."supply_class" is null or "accounts"."supply_class" in ('taxable', 'exempt', 'nil', 'nonGst', 'notASupply'))
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_document_id" text NOT NULL,
	"target_document_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocations_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "allocations_amount_paise_check" CHECK ("allocations"."amount_paise" > 0),
	CONSTRAINT "allocations_state_check" CHECK ("allocations"."state" in ('active', 'reversed'))
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"file_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_target_type_check" CHECK ("attachments"."target_type" in ('prescription'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"action" text NOT NULL,
	"denied" boolean DEFAULT false NOT NULL,
	"actor_id" text NOT NULL,
	"org_id" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"issuer" text DEFAULT 'local:credential' NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"org_id" text NOT NULL,
	"account_id" text NOT NULL,
	"month" date NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "balances_org_id_account_id_month_pk" PRIMARY KEY("org_id","account_id","month")
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"opd_appointment_id" text NOT NULL,
	"item_id" text NOT NULL,
	"description" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"tax_rate_percent" numeric(4, 2) NOT NULL,
	"tax_code" text,
	"revenue_category" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"invoice_id" text,
	"void_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "charges_qty_check" CHECK ("charges"."qty" > 0),
	CONSTRAINT "charges_unit_price_check" CHECK ("charges"."unit_price" >= 0),
	CONSTRAINT "charges_tax_rate_percent_check" CHECK ("charges"."tax_rate_percent" >= 0),
	CONSTRAINT "charges_source_type_check" CHECK ("charges"."source_type" in ('consult_fee', 'item')),
	CONSTRAINT "charges_status_check" CHECK ("charges"."status" in ('pending', 'invoiced', 'voided')),
	CONSTRAINT "charges_revenue_category_check" CHECK ("charges"."revenue_category" in ('consultation', 'procedure', 'lab', 'radiology', 'other'))
);
--> statement-breakpoint
CREATE TABLE "counter" (
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "counter_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"credit_note_id" text NOT NULL,
	"invoice_line_id" text NOT NULL,
	"taxable_value" bigint NOT NULL,
	"tax_amount" bigint NOT NULL,
	"gross" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"credit_note_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"reason" text NOT NULL,
	"subtotal" bigint NOT NULL,
	"tax_total" bigint NOT NULL,
	"total" bigint NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "customer_payers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"policy_number" text,
	"employee_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"sex" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"dob_estimated" boolean DEFAULT false NOT NULL,
	"address" text NOT NULL,
	"email" text,
	"uid" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "customers_sex_check" CHECK ("customers"."sex" in ('male', 'female', 'other', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"default_consult_fee_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"document_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"account_id" text,
	"description" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "document_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "document_lines_kind_check" CHECK ("document_lines"."kind" in ('item', 'account'))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"state" text NOT NULL,
	"number" text,
	"series" text,
	"financial_year" text,
	"document_date" date NOT NULL,
	"party_id" text,
	"exposure_side" text,
	"settlement_kind" text,
	"advance_supply" text,
	"payment_method_id" text,
	"reference" text,
	"narration" text,
	"source" text DEFAULT 'user' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"total_paise" bigint NOT NULL,
	"affects_tax" boolean DEFAULT false NOT NULL,
	"print_snapshot" jsonb,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "documents_type_check" CHECK ("documents"."type" in ('receipt', 'payment', 'invoice', 'bill', 'creditNote', 'debitNote', 'journal', 'openingBalance')),
	CONSTRAINT "documents_state_check" CHECK ("documents"."state" in ('draft', 'posted', 'cancelled')),
	CONSTRAINT "documents_exposure_side_check" CHECK ("documents"."exposure_side" is null or "documents"."exposure_side" in ('receivable', 'payable')),
	CONSTRAINT "documents_settlement_kind_check" CHECK ("documents"."settlement_kind" is null or "documents"."settlement_kind" in ('against', 'advance', 'direct')),
	CONSTRAINT "documents_advance_supply_check" CHECK (coalesce("documents"."settlement_kind" = 'advance', false) = ("documents"."advance_supply" is not null)
        and ("documents"."advance_supply" is null or "documents"."advance_supply" in ('goods', 'exempt', 'taxableService'))),
	CONSTRAINT "documents_source_check" CHECK ("documents"."source" in ('user', 'opening')),
	CONSTRAINT "documents_total_paise_check" CHECK ("documents"."total_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text,
	"size" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"legal_type" text NOT NULL,
	"legal_name" text NOT NULL,
	"pan" text NOT NULL,
	"gstin" text,
	"state_code" text NOT NULL,
	"financial_year_start" integer DEFAULT 4 NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"city" text NOT NULL,
	"pin_code" text NOT NULL,
	"currency" text NOT NULL,
	"code_prefix" text NOT NULL,
	"invoice_prefix" text NOT NULL,
	"receipt_prefix" text NOT NULL,
	"credit_note_prefix" text NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"follow_up_validity_days" integer DEFAULT 14 NOT NULL,
	"unbilled_alert_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_legal_type_check" CHECK ("organization_settings"."legal_type" in ('individual', 'proprietorship', 'partnership', 'llp', 'company', 'trust', 'society')),
	CONSTRAINT "organization_settings_state_code_check" CHECK (char_length("organization_settings"."state_code") = 2),
	CONSTRAINT "organization_settings_financial_year_start_check" CHECK ("organization_settings"."financial_year_start" between 1 and 12),
	CONSTRAINT "organization_settings_follow_up_days_check" CHECK ("organization_settings"."follow_up_validity_days" between 1 and 365),
	CONSTRAINT "organization_settings_unbilled_alert_hours_check" CHECK ("organization_settings"."unbilled_alert_hours" between 1 and 168)
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"roles" text[] NOT NULL,
	"gstin" text,
	"pan" text,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"state_code" text NOT NULL,
	"pin_code" text,
	"email" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "parties_roles_check" CHECK ("parties"."roles" <@ array['customer', 'vendor', 'tenant', 'donor', 'employee', 'government']::text[]),
	CONSTRAINT "parties_state_code_check" CHECK (char_length("parties"."state_code") = 2)
);
--> statement-breakpoint
CREATE TABLE "payers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payers_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "payers_type_check" CHECK ("payers"."type" in ('insurer', 'tpa', 'corporate', 'scheme'))
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"tax_rate_percent" numeric(4, 2) DEFAULT '0' NOT NULL,
	"tax_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "items_category_check" CHECK ("items"."category" in ('consultation', 'procedure', 'lab', 'radiology', 'other')),
	CONSTRAINT "items_unit_price_check" CHECK ("items"."unit_price" >= 0),
	CONSTRAINT "items_tax_rate_check" CHECK ("items"."tax_rate_percent" >= 0 and "items"."tax_rate_percent" <= 99.99)
);
--> statement-breakpoint
CREATE TABLE "practitioners" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"department_id" text NOT NULL,
	"registration_number" text,
	"member_user_id" text,
	"consult_fee_item_id" text,
	"follow_up_fee_item_id" text,
	"follow_up_validity_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practitioners_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "practitioners_follow_up_days_check" CHECK ("practitioners"."follow_up_validity_days" is null or "practitioners"."follow_up_validity_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "opd_appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text,
	"caller_name" text,
	"caller_phone" text,
	"practitioner_id" text NOT NULL,
	"department_id" text NOT NULL,
	"arrival_mode" text NOT NULL,
	"status" text NOT NULL,
	"business_date" date NOT NULL,
	"scheduled_for" timestamp with time zone,
	"token_number" integer,
	"arrived_at" timestamp with time zone,
	"day_order_at" timestamp with time zone GENERATED ALWAYS AS (coalesce("opd_appointments"."arrived_at", "opd_appointments"."scheduled_for")) STORED,
	"cancelled_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"cancel_reason" text,
	"charge_revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opd_appointments_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "opd_appointments_arrival_mode_check" CHECK ("opd_appointments"."arrival_mode" in ('scheduled', 'walk_in')),
	CONSTRAINT "opd_appointments_status_check" CHECK ("opd_appointments"."status" in ('booked', 'checked_in', 'cancelled', 'no_show')),
	CONSTRAINT "opd_appointments_token_positive_check" CHECK ("opd_appointments"."token_number" is null or "opd_appointments"."token_number" > 0),
	CONSTRAINT "opd_appointments_identity_check" CHECK ("opd_appointments"."customer_id" is not null or ("opd_appointments"."caller_name" is not null and "opd_appointments"."caller_phone" is not null)),
	CONSTRAINT "opd_appointments_scheduled_check" CHECK ("opd_appointments"."arrival_mode" <> 'scheduled' or "opd_appointments"."scheduled_for" is not null),
	CONSTRAINT "opd_appointments_arrived_check" CHECK ("opd_appointments"."status" <> 'checked_in' or ("opd_appointments"."customer_id" is not null and "opd_appointments"."token_number" is not null and "opd_appointments"."arrived_at" is not null)),
	CONSTRAINT "opd_appointments_booked_check" CHECK ("opd_appointments"."status" <> 'booked' or ("opd_appointments"."arrival_mode" = 'scheduled' and "opd_appointments"."token_number" is null and "opd_appointments"."arrived_at" is null))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"opd_appointment_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"subtotal" bigint NOT NULL,
	"tax_total" bigint NOT NULL,
	"grand_total" bigint NOT NULL,
	"org_legal_name" text NOT NULL,
	"org_address" text NOT NULL,
	"org_tax_id" text NOT NULL,
	"currency" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_code" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_address" text,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "invoices_discount_amount_check" CHECK ("invoices"."discount_amount" >= 0),
	CONSTRAINT "invoices_subtotal_check" CHECK ("invoices"."subtotal" >= 0),
	CONSTRAINT "invoices_tax_total_check" CHECK ("invoices"."tax_total" >= 0),
	CONSTRAINT "invoices_grand_total_check" CHECK ("invoices"."grand_total" >= 0),
	CONSTRAINT "invoices_discount_not_above_subtotal_check" CHECK ("invoices"."discount_amount" <= "invoices"."subtotal"),
	CONSTRAINT "invoices_total_math_check" CHECK ("invoices"."grand_total" = "invoices"."subtotal" - "invoices"."discount_amount" + "invoices"."tax_total")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"charge_id" text NOT NULL,
	"description" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_subtotal" bigint NOT NULL,
	"allocated_discount" bigint NOT NULL,
	"taxable_value" bigint NOT NULL,
	"tax_amount" bigint NOT NULL,
	"gross" bigint NOT NULL,
	"tax_rate_percent" numeric(4, 2) NOT NULL,
	"tax_code" text,
	"revenue_category" text NOT NULL,
	CONSTRAINT "invoice_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "invoice_lines_revenue_category_check" CHECK ("invoice_lines"."revenue_category" in ('consultation', 'procedure', 'lab', 'radiology', 'other'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text,
	"receipt_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"received_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('cash', 'upi', 'card', 'bank')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"credit_note_id" text NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text,
	"refund_number" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"business_date" date NOT NULL,
	"refunded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_method_check" CHECK ("refunds"."method" in ('cash', 'upi', 'card', 'bank')),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"document_type" text NOT NULL,
	"document_id" text NOT NULL,
	"kind" text NOT NULL,
	"reverses_entry_id" text,
	"entry_date" date NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"narration" text NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "journal_entries_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "journal_entries_kind_check" CHECK ("journal_entries"."kind" in ('post', 'reverse'))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"account_id" text NOT NULL,
	"party_id" text,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "journal_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "journal_lines_debit_check" CHECK ("journal_lines"."debit" >= 0),
	CONSTRAINT "journal_lines_credit_check" CHECK ("journal_lines"."credit" >= 0),
	CONSTRAINT "journal_lines_one_side_check" CHECK (("journal_lines"."debit" = 0) <> ("journal_lines"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"account_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "party_ledger_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"party_id" text NOT NULL,
	"document_id" text NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"entry_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_ledger_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "party_ledger_lines_side_check" CHECK ("party_ledger_lines"."side" in ('receivable', 'payable')),
	CONSTRAINT "party_ledger_lines_kind_check" CHECK ("party_ledger_lines"."kind" in ('post', 'reverse'))
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"org_id" text NOT NULL,
	"document_type" text NOT NULL,
	"financial_year" text NOT NULL,
	"prefix" text NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "number_series_org_id_document_type_financial_year_pk" PRIMARY KEY("org_id","document_type","financial_year")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_fk" FOREIGN KEY ("org_id","parent_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_org_id_source_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","source_document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_org_id_target_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","target_document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_file_id_file_org_id_id_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."file"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_opd_appointment_id_opd_appointments_org_id_id_fk" FOREIGN KEY ("org_id","opd_appointment_id") REFERENCES "public"."opd_appointments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter" ADD CONSTRAINT "counter_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_org_id_credit_note_id_credit_notes_org_id_id_fk" FOREIGN KEY ("org_id","credit_note_id") REFERENCES "public"."credit_notes"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_org_id_invoice_line_id_invoice_lines_org_id_id_fk" FOREIGN KEY ("org_id","invoice_line_id") REFERENCES "public"."invoice_lines"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payers" ADD CONSTRAINT "customer_payers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payers" ADD CONSTRAINT "customer_payers_org_id_customer_id_customers_org_id_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payers" ADD CONSTRAINT "customer_payers_org_id_payer_id_payers_org_id_id_fk" FOREIGN KEY ("org_id","payer_id") REFERENCES "public"."payers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_default_consult_fee_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","default_consult_fee_item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_org_id_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_payment_method_id_payment_methods_org_id_id_fk" FOREIGN KEY ("org_id","payment_method_id") REFERENCES "public"."payment_methods"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payers" ADD CONSTRAINT "payers_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_member_user_id_user_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_department_id_departments_org_id_id_fk" FOREIGN KEY ("org_id","department_id") REFERENCES "public"."departments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_consult_fee_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","consult_fee_item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_org_id_follow_up_fee_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","follow_up_fee_item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_customer_id_customers_org_id_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_practitioner_id_practitioners_org_id_id_fk" FOREIGN KEY ("org_id","practitioner_id") REFERENCES "public"."practitioners"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opd_appointments" ADD CONSTRAINT "opd_appointments_org_id_department_id_departments_org_id_id_fk" FOREIGN KEY ("org_id","department_id") REFERENCES "public"."departments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_opd_appointment_id_opd_appointments_org_id_id_fk" FOREIGN KEY ("org_id","opd_appointment_id") REFERENCES "public"."opd_appointments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_customer_id_customers_org_id_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_charge_id_charges_org_id_id_fk" FOREIGN KEY ("org_id","charge_id") REFERENCES "public"."charges"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_refunded_by_user_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_invoice_id_invoices_org_id_id_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_credit_note_id_credit_notes_org_id_id_fk" FOREIGN KEY ("org_id","credit_note_id") REFERENCES "public"."credit_notes"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_reverses_entry_id_journal_entries_org_id_id_fk" FOREIGN KEY ("org_id","reverses_entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_entry_id_journal_entries_org_id_id_fk" FOREIGN KEY ("org_id","entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_ledger_lines" ADD CONSTRAINT "party_ledger_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_ledger_lines" ADD CONSTRAINT "party_ledger_lines_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_ledger_lines" ADD CONSTRAINT "party_ledger_lines_org_id_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_code_idx" ON "accounts" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_system_key_idx" ON "accounts" USING btree ("org_id","system_key") WHERE "accounts"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "allocations_org_source_document_idx" ON "allocations" USING btree ("org_id","source_document_id");--> statement-breakpoint
CREATE INDEX "allocations_org_target_document_idx" ON "allocations" USING btree ("org_id","target_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_org_target_file_uq" ON "attachments" USING btree ("org_id","target_type","target_id","file_id");--> statement-breakpoint
CREATE INDEX "attachments_org_target_idx" ON "attachments" USING btree ("org_id","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_org_file_idx" ON "attachments" USING btree ("org_id","file_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_id_idx" ON "audit_log" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_uidx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "charges_org_opd_appointment_idx" ON "charges" USING btree ("org_id","opd_appointment_id","status");--> statement-breakpoint
CREATE INDEX "charges_org_status_created_idx" ON "charges" USING btree ("org_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "credit_note_lines_org_credit_note_idx" ON "credit_note_lines" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE INDEX "credit_note_lines_org_invoice_line_idx" ON "credit_note_lines" USING btree ("org_id","invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_org_number_idx" ON "credit_notes" USING btree ("org_id","credit_note_number");--> statement-breakpoint
CREATE INDEX "credit_notes_org_invoice_idx" ON "credit_notes" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "credit_notes_org_business_date_idx" ON "credit_notes" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_payers_org_customer_idx" ON "customer_payers" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_code_idx" ON "customers" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_uid_idx" ON "customers" USING btree ("org_id","uid") WHERE "customers"."uid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_name_idx" ON "departments" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "document_lines_org_document_idx" ON "document_lines" USING btree ("org_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_org_number_idx" ON "documents" USING btree ("org_id","type","financial_year","number") WHERE "documents"."number" is not null;--> statement-breakpoint
CREATE INDEX "documents_org_type_date_idx" ON "documents" USING btree ("org_id","type","document_date");--> statement-breakpoint
CREATE INDEX "documents_org_type_id_idx" ON "documents" USING btree ("org_id","type","id");--> statement-breakpoint
CREATE INDEX "documents_org_party_idx" ON "documents" USING btree ("org_id","party_id");--> statement-breakpoint
CREATE INDEX "file_org_created_idx" ON "file" USING btree ("org_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "parties_org_normalized_name_idx" ON "parties" USING btree ("org_id","normalized_name");--> statement-breakpoint
CREATE INDEX "parties_org_name_idx" ON "parties" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_org_gstin_idx" ON "parties" USING btree ("org_id","gstin") WHERE "parties"."gstin" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payers_org_name_idx" ON "payers" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "items_org_code_idx" ON "items" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "items_org_category_name_idx" ON "items" USING btree ("org_id","category","name");--> statement-breakpoint
CREATE INDEX "items_org_name_idx" ON "items" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "practitioners_org_name_idx" ON "practitioners" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "opd_appointments_org_practitioner_date_token_uq" ON "opd_appointments" USING btree ("org_id","practitioner_id","business_date","token_number") WHERE "opd_appointments"."token_number" is not null;--> statement-breakpoint
CREATE INDEX "opd_appointments_org_date_day_order_idx" ON "opd_appointments" USING btree ("org_id","business_date","day_order_at","id");--> statement-breakpoint
CREATE INDEX "opd_appointments_org_customer_date_idx" ON "opd_appointments" USING btree ("org_id","customer_id","business_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "opd_appointments_org_customer_arrived_idx" ON "opd_appointments" USING btree ("org_id","customer_id","practitioner_id","arrived_at") WHERE "opd_appointments"."status" = 'checked_in';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_idx" ON "invoices" USING btree ("org_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_org_opd_appointment_idx" ON "invoices" USING btree ("org_id","opd_appointment_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_org_business_date_idx" ON "invoices" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "invoices_org_created_idx" ON "invoices" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_charge_idx" ON "invoice_lines" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_org_invoice_idx" ON "invoice_lines" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_receipt_number_idx" ON "payments" USING btree ("org_id","receipt_number");--> statement-breakpoint
CREATE INDEX "payments_org_business_date_idx" ON "payments" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "payments_org_invoice_idx" ON "payments" USING btree ("org_id","invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_org_number_idx" ON "refunds" USING btree ("org_id","refund_number");--> statement-breakpoint
CREATE INDEX "refunds_org_business_date_idx" ON "refunds" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "refunds_org_invoice_idx" ON "refunds" USING btree ("org_id","invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_org_credit_note_idx" ON "refunds" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_document_kind_idx" ON "journal_entries" USING btree ("org_id","document_type","document_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_reverses_entry_idx" ON "journal_entries" USING btree ("org_id","reverses_entry_id") WHERE "journal_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" USING btree ("org_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_org_account_idx" ON "journal_lines" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_org_entry_idx" ON "journal_lines" USING btree ("org_id","entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_org_name_idx" ON "payment_methods" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "party_ledger_lines_org_party_idx" ON "party_ledger_lines" USING btree ("org_id","party_id","side");--> statement-breakpoint
CREATE INDEX "party_ledger_lines_org_document_idx" ON "party_ledger_lines" USING btree ("org_id","document_id");