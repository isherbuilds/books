import type { AppPermission } from "@accly/auth/access";
import {
  Building2Icon,
  ClipboardListIcon,
  ChartColumnIcon,
  ChartNoAxesColumnIncreasingIcon,
  FileIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  ListOrderedIcon,
  ReceiptTextIcon,
  WalletIcon,
  StethoscopeIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

// One source of truth, not one visual list: these render in the sidebar, the
// settings strip, the reports hub and the onboarding checklist. A new page means
// one line in the section it belongs to.
type NavEntry<Route extends string> = {
  to: Route;
  label: string;
  permission: AppPermission;
};

export const NAV_GROUPS = ["Sales", "Finance", "Workspace"] as const;
type NavGroup = (typeof NAV_GROUPS)[number];

type PrimaryNavItem = NavEntry<
  | "/$orgSlug/dashboard"
  | "/$orgSlug/customers"
  | "/$orgSlug/opd"
  | "/$orgSlug/billing"
  | "/$orgSlug/reports"
  | "/$orgSlug/files"
> & { icon: LucideIcon; group: NavGroup };

// No entry's path is a prefix of another's, so prefix matching highlights exactly
// one item. Nesting a second entry under an existing one lit up both.
export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  {
    to: "/$orgSlug/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    group: "Sales",
    permission: { member: ["read"] },
  },
  // Legacy outpatient desk, kept while its billing wiring is the only path from a
  // service to an invoice. It moves out when documents are raised directly.
  {
    to: "/$orgSlug/opd",
    label: "OPD",
    icon: ListOrderedIcon,
    group: "Sales",
    permission: { opd: ["read"] },
  },
  {
    to: "/$orgSlug/customers",
    label: "Customers",
    icon: UsersIcon,
    group: "Sales",
    permission: { customer: ["read"] },
  },
  {
    to: "/$orgSlug/billing",
    label: "Billing",
    icon: ReceiptTextIcon,
    group: "Finance",
    permission: { billing: ["read"] },
  },
  {
    to: "/$orgSlug/reports",
    label: "Reports",
    icon: ChartColumnIcon,
    group: "Finance",
    permission: { report: ["readDailyCollections"] },
  },
  {
    to: "/$orgSlug/files",
    label: "Files",
    icon: FileIcon,
    group: "Workspace",
    permission: { file: ["read"] },
  },
];

type SettingsTab = NavEntry<
  | "/$orgSlug/settings/organization"
  | "/$orgSlug/settings/members"
  | "/$orgSlug/settings/staff"
  | "/$orgSlug/settings/items"
  | "/$orgSlug/settings/payers"
  | "/$orgSlug/settings/audit"
>;

export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    to: "/$orgSlug/settings/organization",
    label: "Organization",
    // Read is org-wide, but the page is a save form — surface it only to roles that
    // can actually save.
    permission: { settings: ["update"] },
  },
  { to: "/$orgSlug/settings/members", label: "Members", permission: { member: ["read"] } },
  { to: "/$orgSlug/settings/staff", label: "Staff", permission: { staff: ["update"] } },
  { to: "/$orgSlug/settings/items", label: "Items", permission: { item: ["update"] } },
  { to: "/$orgSlug/settings/payers", label: "Payers", permission: { payer: ["update"] } },
  { to: "/$orgSlug/settings/audit", label: "Audit", permission: { audit: ["read"] } },
];

type ReportLink = NavEntry<
  | "/$orgSlug/reports/gst"
  | "/$orgSlug/reports/trial-balance"
  | "/$orgSlug/reports/balance-sheet"
  | "/$orgSlug/reports/daily-collections"
  | "/$orgSlug/reports/opd-register"
> & { icon: LucideIcon; description: string };

export const REPORT_LINKS: readonly ReportLink[] = [
  {
    to: "/$orgSlug/reports/gst",
    label: "GST outward register",
    description: "Invoices, credit notes, rate totals, and HSN/SAC totals for the selected period.",
    icon: ReceiptTextIcon,
    permission: { report: ["readFinancial"] },
  },
  {
    to: "/$orgSlug/reports/daily-collections",
    label: "Daily collections",
    description: "Payments minus refunds by method and business date.",
    icon: WalletIcon,
    permission: { report: ["readDailyCollections"] },
  },
  {
    to: "/$orgSlug/reports/opd-register",
    label: "OPD register",
    description: "One row per appointment with attendance and money.",
    icon: ClipboardListIcon,
    permission: { report: ["readOpdRegister"] },
  },
  {
    to: "/$orgSlug/reports/trial-balance",
    label: "Trial balance",
    description: "Opening balances, period debits and credits, and closing balances by account.",
    icon: ChartNoAxesColumnIncreasingIcon,
    permission: { report: ["readFinancial"] },
  },
  {
    to: "/$orgSlug/reports/balance-sheet",
    label: "Billing ledger balance sheet",
    description: "Assets, liabilities, and surplus created by billing activity.",
    icon: LandmarkIcon,
    permission: { report: ["readFinancial"] },
  },
];

type SetupStep = NavEntry<
  | "/$orgSlug/settings/organization"
  | "/$orgSlug/settings/members"
  | "/$orgSlug/settings/staff"
  | "/$orgSlug/settings/items"
> & { icon: LucideIcon; description: string };

/** The order a new organization is configured in, not the settings tab order. */
export const SETUP_STEPS: readonly SetupStep[] = [
  {
    to: "/$orgSlug/settings/organization",
    label: "Confirm organization details",
    description: "Set the legal name, timezone, tax identity, and document numbering.",
    icon: Building2Icon,
    permission: { settings: ["update"] },
  },
  {
    to: "/$orgSlug/settings/staff",
    label: "Add departments and staff",
    description: "Prepare the people and departments used at registration.",
    icon: StethoscopeIcon,
    permission: { staff: ["update"] },
  },
  {
    to: "/$orgSlug/settings/items",
    label: "Build the item list",
    description: "Define billable services, prices, and tax treatment.",
    icon: ListChecksIcon,
    permission: { item: ["update"] },
  },
  {
    to: "/$orgSlug/settings/members",
    label: "Review the team",
    description: "See who has access and invite the people who will work here.",
    icon: UsersIcon,
    permission: { member: ["read"] },
  },
];
