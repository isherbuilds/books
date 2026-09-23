import type { AppPermission } from "@accly/auth/access";
import {
  Building2Icon,
  BookOpenTextIcon,
  ContactRoundIcon,
  FileIcon,
  FileTextIcon,
  LandmarkIcon,
  ListTreeIcon,
  LockIcon,
  PackageIcon,
  ReceiptIndianRupeeIcon,
  ScaleIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

// One source of truth for three consumers: the sidebar and settings strip render
// destinations, while onboarding renders its setup subset. Add a page to the
// section whose navigation surface owns it.
type NavEntry<Route extends string> = {
  to: Route;
  label: string;
  permission: AppPermission;
};

export const NAV_GROUPS = ["Sales", "Accounting", "Workspace"] as const;

// Whoever reads money accounts, methods and balances sees Banks, the CA included. The
// tab and the route loader share it, so they cannot disagree and redirect-loop.
export const BANKS_PERMISSION: AppPermission = {
  account: ["read"],
  paymentMethod: ["read"],
  report: ["readFinancial"],
};

// Adding accounts and methods and archiving methods; also the setup step's audience.
export const BANKS_MANAGE_PERMISSION: AppPermission = {
  account: ["create"],
  paymentMethod: ["create", "update"],
};

type NavGroup = (typeof NAV_GROUPS)[number];

type PrimaryNavItem = NavEntry<
  | "/$orgSlug/receipts"
  | "/$orgSlug/invoices"
  | "/$orgSlug/parties"
  | "/$orgSlug/items"
  | "/$orgSlug/banking"
  | "/$orgSlug/journals"
  | "/$orgSlug/accounts"
  | "/$orgSlug/opening-balance"
  | "/$orgSlug/locks"
  | "/$orgSlug/files"
> & {
  icon: LucideIcon;
  group: NavGroup;
};

// No entry's path is a prefix of another's, so prefix matching highlights exactly
// one item. Nesting a second entry under an existing one lit up both.
export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  {
    to: "/$orgSlug/receipts",
    label: "Receipts",
    icon: ReceiptIndianRupeeIcon,
    group: "Sales",
    permission: { receipt: ["read"] },
  },
  {
    to: "/$orgSlug/invoices",
    label: "Invoices",
    icon: FileTextIcon,
    group: "Sales",
    permission: { invoice: ["read"] },
  },
  {
    to: "/$orgSlug/parties",
    label: "Parties",
    icon: ContactRoundIcon,
    group: "Sales",
    permission: { party: ["read"] },
  },
  {
    to: "/$orgSlug/items",
    label: "Items",
    icon: PackageIcon,
    group: "Sales",
    permission: { item: ["read"] },
  },
  {
    to: "/$orgSlug/banking",
    label: "Banking",
    icon: LandmarkIcon,
    group: "Accounting",
    permission: BANKS_PERMISSION,
  },
  {
    to: "/$orgSlug/journals",
    label: "Journals",
    icon: BookOpenTextIcon,
    group: "Accounting",
    permission: { journal: ["read"] },
  },
  {
    to: "/$orgSlug/accounts",
    label: "Chart of accounts",
    icon: ListTreeIcon,
    group: "Accounting",
    permission: { account: ["read"] },
  },
  {
    to: "/$orgSlug/opening-balance",
    label: "Opening balance",
    icon: ScaleIcon,
    group: "Accounting",
    permission: { openingBalance: ["read"] },
  },
  {
    to: "/$orgSlug/locks",
    label: "Locks",
    icon: LockIcon,
    group: "Accounting",
    permission: { lock: ["read"] },
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
  "/$orgSlug/settings/organization" | "/$orgSlug/settings/members" | "/$orgSlug/settings/audit"
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
  { to: "/$orgSlug/settings/audit", label: "Audit", permission: { audit: ["read"] } },
];

type SetupStep = NavEntry<
  "/$orgSlug/settings/organization" | "/$orgSlug/banking" | "/$orgSlug/settings/members"
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
    to: "/$orgSlug/banking",
    label: "Add bank accounts and payment methods",
    description: "One account per bank and cash box; one method per way money arrives.",
    icon: LandmarkIcon,
    permission: BANKS_MANAGE_PERMISSION,
  },
  {
    to: "/$orgSlug/settings/members",
    label: "Review the team",
    description: "See who has access and invite the people who will work here.",
    icon: UsersIcon,
    permission: { member: ["read"] },
  },
];
