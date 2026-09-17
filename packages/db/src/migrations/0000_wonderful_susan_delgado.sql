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
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('asset', 'liability', 'equity', 'income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_document_id" text NOT NULL,
	"target_document_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"kind" text NOT NULL,
	"reverses_allocation_id" text,
	"entry_date" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocations_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "allocations_amount_paise_check" CHECK ("allocations"."amount_paise" > 0),
	CONSTRAINT "allocations_kind_check" CHECK ("allocations"."kind" in ('apply', 'reverse'))
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
CREATE TABLE "document_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"document_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"account_id" text,
	"item_id" text,
	"description" text NOT NULL,
	"hsn_sac" text,
	"unit" text,
	"quantity" integer,
	"unit_price_paise" bigint,
	"tax_rate_id" text,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "document_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "document_lines_kind_check" CHECK ("document_lines"."kind" in ('item', 'account')),
	CONSTRAINT "document_lines_quantity_check" CHECK ("document_lines"."quantity" is null or "document_lines"."quantity" >= 1)
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
	"due_date" date,
	"place_of_supply_state_code" text,
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
	"round_off_paise" bigint NOT NULL,
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
	CONSTRAINT "documents_advance_supply_check" CHECK (case when "documents"."type" = 'receipt' and "documents"."settlement_kind" = 'advance' then "documents"."advance_supply" is not null when "documents"."type" = 'receipt' and "documents"."settlement_kind" = 'against' then true else "documents"."advance_supply" is null end),
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
	"invoice_prefix" text NOT NULL,
	"receipt_prefix" text NOT NULL,
	"payment_prefix" text NOT NULL,
	"credit_note_prefix" text NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_financial_year_start_check" CHECK ("organization_settings"."financial_year_start" between 1 and 12)
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
	CONSTRAINT "parties_org_id_id_unique" UNIQUE("org_id","id")
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
CREATE TABLE "tds_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tds_sections_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "tds_sections_org_id_code_effective_from_unique" UNIQUE("org_id","code","effective_from"),
	CONSTRAINT "tds_sections_effective_range_check" CHECK ("tds_sections"."effective_to" is null or "tds_sections"."effective_to" >= "tds_sections"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "tax_rates_rate_basis_points_check" CHECK ("tax_rates"."rate_basis_points" between 0 and 10000),
	CONSTRAINT "tax_rates_effective_range_check" CHECK ("tax_rates"."effective_to" is null or "tax_rates"."effective_to" >= "tax_rates"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"hsn_sac" text,
	"unit" text,
	"unit_price_paise" bigint NOT NULL,
	"income_account_id" text NOT NULL,
	"tax_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "items_unit_price_paise_check" CHECK ("items"."unit_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tds_deductions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"document_id" text NOT NULL,
	"tds_section_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "tds_deductions_org_document_unique" UNIQUE("org_id","document_id"),
	CONSTRAINT "tds_deductions_amount_paise_check" CHECK ("tds_deductions"."amount_paise" >= 0)
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
	CONSTRAINT "number_series_org_id_document_type_financial_year_prefix_pk" PRIMARY KEY("org_id","document_type","financial_year","prefix")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_fk" FOREIGN KEY ("org_id","parent_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_org_id_source_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","source_document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_org_id_target_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","target_document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_reverses_fk" FOREIGN KEY ("org_id","reverses_allocation_id") REFERENCES "public"."allocations"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_org_id_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_org_id_item_id_items_org_id_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_org_id_tax_rate_id_tax_rates_org_id_id_fk" FOREIGN KEY ("org_id","tax_rate_id") REFERENCES "public"."tax_rates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_payment_method_id_payment_methods_org_id_id_fk" FOREIGN KEY ("org_id","payment_method_id") REFERENCES "public"."payment_methods"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_reverses_entry_id_journal_entries_org_id_id_fk" FOREIGN KEY ("org_id","reverses_entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_entry_id_journal_entries_org_id_id_fk" FOREIGN KEY ("org_id","entry_id") REFERENCES "public"."journal_entries"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_org_id_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_sections" ADD CONSTRAINT "tds_sections_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_org_id_income_account_id_accounts_org_id_id_fk" FOREIGN KEY ("org_id","income_account_id") REFERENCES "public"."accounts"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_org_id_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_org_id_tds_section_id_tds_sections_org_id_id_fk" FOREIGN KEY ("org_id","tds_section_id") REFERENCES "public"."tds_sections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_ledger_lines" ADD CONSTRAINT "party_ledger_lines_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_ledger_lines" ADD CONSTRAINT "party_ledger_lines_org_id_party_id_parties_org_id_id_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_ledger_lines" ADD CONSTRAINT "party_ledger_lines_org_id_document_id_documents_org_id_id_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_code_idx" ON "accounts" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_org_system_key_idx" ON "accounts" USING btree ("org_id","system_key") WHERE "accounts"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "allocations_org_source_document_idx" ON "allocations" USING btree ("org_id","source_document_id");--> statement-breakpoint
CREATE INDEX "allocations_org_target_document_idx" ON "allocations" USING btree ("org_id","target_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_org_reverses_idx" ON "allocations" USING btree ("org_id","reverses_allocation_id") WHERE "allocations"."reverses_allocation_id" is not null;--> statement-breakpoint
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
CREATE INDEX "document_lines_org_document_idx" ON "document_lines" USING btree ("org_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_org_number_idx" ON "documents" USING btree ("org_id","type","financial_year","number") WHERE "documents"."number" is not null;--> statement-breakpoint
CREATE INDEX "documents_org_type_date_idx" ON "documents" USING btree ("org_id","type","document_date");--> statement-breakpoint
CREATE INDEX "documents_org_type_id_idx" ON "documents" USING btree ("org_id","type","id");--> statement-breakpoint
CREATE INDEX "documents_org_party_idx" ON "documents" USING btree ("org_id","party_id");--> statement-breakpoint
CREATE INDEX "documents_posted_receipt_party_idx" ON "documents" USING btree ("org_id","party_id","total_paise") WHERE "documents"."type" = 'receipt' and "documents"."state" = 'posted' and "documents"."party_id" is not null;--> statement-breakpoint
CREATE INDEX "file_org_created_idx" ON "file" USING btree ("org_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "parties_org_normalized_name_idx" ON "parties" USING btree ("org_id","normalized_name");--> statement-breakpoint
CREATE INDEX "parties_org_name_idx" ON "parties" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "parties_org_gstin_idx" ON "parties" USING btree ("org_id","gstin") WHERE "parties"."gstin" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_document_kind_idx" ON "journal_entries" USING btree ("org_id","document_type","document_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_reverses_entry_idx" ON "journal_entries" USING btree ("org_id","reverses_entry_id") WHERE "journal_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" USING btree ("org_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_org_account_idx" ON "journal_lines" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_org_entry_idx" ON "journal_lines" USING btree ("org_id","entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_org_name_idx" ON "payment_methods" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_org_code_from_idx" ON "tax_rates" USING btree ("org_id","code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "items_org_normalized_name_idx" ON "items" USING btree ("org_id","normalized_name");--> statement-breakpoint
CREATE INDEX "party_ledger_lines_org_party_idx" ON "party_ledger_lines" USING btree ("org_id","party_id","side");--> statement-breakpoint
CREATE INDEX "party_ledger_lines_org_document_idx" ON "party_ledger_lines" USING btree ("org_id","document_id");