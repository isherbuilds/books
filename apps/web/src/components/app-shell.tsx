import { authorize } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@accly/ui/components/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@accly/ui/components/dropdown-menu";
import { cn } from "@accly/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { ClientOnly, Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  HouseIcon,
  LogOutIcon,
  PanelLeftIcon,
  SettingsIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState, type ReactNode } from "react";

import { Monogram } from "@/components/monogram";
import { PaletteTrigger } from "@/components/palette/palette";
import { authClient } from "@/lib/auth-client";
import { useMembership } from "@/lib/membership";
import { NAV_GROUPS, PRIMARY_NAV, SETTINGS_TABS, type NavGroup } from "@/lib/navigation";

// One class for every rail row, links and menu triggers alike. TanStack Link marks
// the active route with `data-status="active"`.
const ROW =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-sidebar-accent/60 data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground data-[status=active]:[&_svg]:text-foreground";

/** The rail group that holds the current page, if any. */
function useActiveGroup(): NavGroup | undefined {
  return useLocation({
    select: ({ pathname, search }) => {
      const path = pathname.replace(/^\/[^/]+/, "");
      const type = "type" in search ? search.type : undefined;

      return PRIMARY_NAV.find(({ to, noteType }) => {
        const section = to.replace("/$orgSlug", "");

        return (
          (path === section || path.startsWith(`${section}/`)) &&
          (noteType === undefined || noteType === type)
        );
      })?.group;
    },
  });
}

/** The path of the current page with the org slug removed: `/invoices/…`. */
function useSectionPath(): string {
  return useLocation({ select: (location) => location.pathname.replace(/^\/[^/]+/, "") });
}

// Switching org keeps the section: an operator comparing entities stays on Invoices.
// A record id belongs to one org, so a detail page lands on its register instead.
function sectionIn(path: string) {
  const entries = [...PRIMARY_NAV, ...SETTINGS_TABS];

  return entries.find(({ to }) => {
    const section = to.replace("/$orgSlug", "");

    return path === section || path.startsWith(`${section}/`);
  })?.to;
}

function OrgIdentity({ name }: { name: string }) {
  return (
    <>
      <Monogram label={name} tone="accent" />
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <ChevronsUpDownIcon />
    </>
  );
}

function OrgSwitcher({ activeOrgSlug }: { activeOrgSlug: string }) {
  const organizations = useMembership(activeOrgSlug, (membership) => membership.organizations);
  const founder = useMembership(activeOrgSlug, (membership) => membership.founder);
  const path = useSectionPath();
  const section = sectionIn(path) ?? "/$orgSlug";

  // Credit and Debit notes share a register; the type filter keeps the switch on the same one.
  const noteType = useLocation({
    select: ({ search }) => ("type" in search ? search.type : undefined),
  });

  const name =
    organizations.find((org) => org.slug === activeOrgSlug)?.name ?? "Unknown organization";

  // Base UI popups mount on the client; the fallback paints the same row meanwhile.
  return (
    <ClientOnly
      fallback={
        <div className={cn(ROW, "h-12")}>
          <OrgIdentity name={name} />
        </div>
      }
    >
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(ROW, "h-12")}>
          <OrgIdentity name={name} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-(--anchor-width) min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                render={
                  <Link
                    to={section}
                    params={{ orgSlug: org.slug }}
                    search={
                      section === "/$orgSlug/notes" && noteType ? { type: noteType } : undefined
                    }
                  />
                }
                aria-current={org.slug === activeOrgSlug ? "page" : undefined}
                className={org.slug === activeOrgSlug ? "font-medium" : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                {org.slug === activeOrgSlug && <CheckIcon />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link to="/join" />}>Join organization</DropdownMenuItem>
            {founder ? (
              <DropdownMenuItem render={<Link to="/create" />}>
                Create organization
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  );
}

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

function UserIdentity({ name, email }: { name: string; email: string }) {
  return (
    <>
      <Monogram label={name} />
      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-muted-foreground">{email}</span>
      </span>
    </>
  );
}

function UserMenu({ orgSlug }: { orgSlug: string }) {
  const user = useMembership(orgSlug, (membership) => membership.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const name = user.name || user.email;

  return (
    <ClientOnly
      fallback={
        <div className={cn(ROW, "h-12")}>
          <UserIdentity name={name} email={user.email} />
        </div>
      }
    >
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(ROW, "h-12")}>
          <UserIdentity name={name} email={user.email} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-(--anchor-width) min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
              {THEMES.map(({ value, label }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      // Query keys partition by org, not by user: without this the next account signed
                      // in on this tab reads the previous one's cached responses.
                      queryClient.clear();
                      navigate({ to: "/login" });
                    },
                  },
                });
              }}
            >
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ClientOnly>
  );
}

function OrgNav({ orgSlug, onSelect }: { orgSlug: string; onSelect?: () => void }) {
  // The `/$orgSlug` loader awaits `member.me` before this renders, so the roles are
  // already cached: no pending nav that shows every link and then removes some.
  const roles = useMembership(orgSlug, (membership) => membership.roles);
  const visible = PRIMARY_NAV.filter(({ permission }) => authorize(roles, permission));
  const showSettings = SETTINGS_TABS.some(({ permission }) => authorize(roles, permission));
  const activeGroup = useActiveGroup();

  // Every group starts open: the whole rail fits a laptop screen, so a Zoho-style
  // accordion (one group at a time) would only add a click and move the rows under
  // the pointer. A member collapses the groups they never use instead.
  const [collapsed, setCollapsed] = useState<ReadonlySet<NavGroup>>(() => new Set());
  const [shownGroup, setShownGroup] = useState(activeGroup);

  // Navigating into a collapsed group opens it, so the highlight is never hidden.
  if (activeGroup !== shownGroup) {
    setShownGroup(activeGroup);

    if (activeGroup && collapsed.has(activeGroup)) {
      setCollapsed(new Set([...collapsed].filter((group) => group !== activeGroup)));
    }
  }

  const toggle = (group: NavGroup, open: boolean) =>
    setCollapsed((previous) => {
      if (open !== previous.has(group)) return previous;

      const next = new Set(previous);

      if (open) next.delete(group);
      else next.add(group);

      return next;
    });

  return (
    <>
      <div className="flex flex-col gap-2 p-2">
        <OrgSwitcher activeOrgSlug={orgSlug} />
        <PaletteTrigger className={ROW} onOpen={onSelect} />
      </div>

      <nav
        aria-label="Primary"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-2 pt-1"
      >
        <Link
          to="/$orgSlug"
          params={{ orgSlug }}
          preloadDelay={0}
          activeOptions={{ exact: true, includeSearch: false }}
          className={ROW}
        >
          <HouseIcon />
          <span className="truncate">Home</span>
        </Link>

        {NAV_GROUPS.map((group) => {
          const items = visible.filter((item) => item.group === group);

          if (items.length === 0) return null;

          // A native disclosure: it server-renders open and toggles without a script;
          // React only mirrors the state so navigation can reopen it.
          return (
            <details
              key={group}
              open={!collapsed.has(group)}
              onToggle={(event) => toggle(group, event.currentTarget.open)}
              className="group/section mt-3"
            >
              <summary className="group/summary flex h-6 cursor-default list-none items-center gap-1 rounded-md px-2 text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                <span className="flex-1">{group}</span>
                {/* Quiet while open; always shown once a group is closed. */}
                <ChevronRightIcon className="size-3 opacity-0 group-hover/summary:opacity-100 group-focus-visible/summary:opacity-100 group-open/section:rotate-90 group-not-open/section:opacity-100" />
              </summary>
              <ul className="flex flex-col gap-0.5">
                {items.map(({ to, label, icon: Icon, noteType }) => (
                  <li key={label}>
                    <Link
                      to={to}
                      params={{ orgSlug }}
                      search={noteType ? { type: noteType } : undefined}
                      preloadDelay={0}
                      className={ROW}
                    >
                      <Icon />
                      <span className="truncate">{label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 p-2">
        {showSettings && (
          <Link to="/$orgSlug/settings" params={{ orgSlug }} preloadDelay={0} className={ROW}>
            <SettingsIcon />
            <span className="truncate">Settings</span>
          </Link>
        )}
        <UserMenu orgSlug={orgSlug} />
      </div>
    </>
  );
}

// Midday's shell (AGPL-3.0, midday-ai/midday apps/dashboard): a plain <aside> from
// `lg` up, and a self-contained mobile menu that owns its Sheet and open state.
/** Opens the navigation below `lg`; `PageHeader` renders it. */
export function MobileMenu() {
  const { orgSlug } = useParams({ from: "/$orgSlug" });
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open navigation"
        aria-expanded={open}
        className="print:hidden lg:hidden"
        onClick={() => setOpen(true)}
      >
        <PanelLeftIcon />
      </Button>
      <ClientOnly>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            // Every link, including the org switcher's portalled items, closes the menu.
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
            }}
            className="inset-y-0 right-auto left-0 w-72 max-w-[calc(100vw-3rem)] rounded-none border-0 bg-sidebar text-sidebar-foreground md:inset-y-0 md:left-0 md:w-72 print:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <OrgNav orgSlug={orgSlug} onSelect={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </ClientOnly>
    </>
  );
}

export function AppShell({ orgSlug, children }: { orgSlug: string; children: ReactNode }) {
  return (
    <div className="flex h-svh overflow-hidden bg-sidebar text-sidebar-foreground print:h-auto print:overflow-visible">
      <aside className="hidden w-64 flex-col lg:flex print:hidden">
        <OrgNav orgSlug={orgSlug} />
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-card text-foreground lg:m-2 lg:ml-0 lg:rounded-md lg:shadow-sm print:m-0 print:overflow-visible print:shadow-none"
      >
        {children}
      </main>
    </div>
  );
}
