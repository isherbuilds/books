import { Button, buttonVariants } from "@accly/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon, Building2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { InvitationAccess } from "@/components/invitation-access";
import { OrganizationEntryLayout } from "@/components/organization-entry-layout";
import { ErrorNote } from "@/components/page";
import { SignInForm } from "@/components/sign-in-form";
import { WaveLoader } from "@/components/wave-loader";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { sortOrganizations } from "@/lib/membership";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/join")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { invitation?: string } =>
    typeof search.invitation === "string" && search.invitation.length > 0
      ? { invitation: search.invitation }
      : {},
  component: JoinOrganizationRoute,
});

function JoinOrganizationRoute() {
  const { invitation } = Route.useSearch();
  const { data: session, isPending, error } = authClient.useSession();

  let content: ReactNode = <WaveLoader label="Loading your account" />;

  if (error) {
    content = <ErrorNote title="Could not load your account" error={error} />;
  } else if (!isPending && !session) {
    content = invitation ? (
      <InvitationAccess key={invitation} invitationId={invitation} />
    ) : (
      <SignInForm />
    );
  } else if (session) {
    content = (
      <div key={session.user.id} className="flex flex-col gap-6">
        {invitation ? (
          <InvitationAccess
            key={invitation}
            invitationId={invitation}
            accountEmail={session.user.email}
          />
        ) : (
          <OrganizationPicker userId={session.user.id} />
        )}
        <SwitchAccount email={session.user.email} />
      </div>
    );
  }

  return (
    <OrganizationEntryLayout
      eyebrow="JOIN YOUR BUSINESS"
      title="Continue where your business works."
      description="Create your account from an invitation, or sign in to open your organizations."
      aside={null}
    >
      {content}
    </OrganizationEntryLayout>
  );
}

function OrganizationPicker({ userId }: { userId: string }) {
  const destinations = useQuery({
    queryKey: ["auth", "join", userId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.list();

      if (error)
        throw new Error(authErrorMessage(error, "Could not load organizations. Try again."));

      return sortOrganizations(data);
    },
  });

  // Only the founding account may create one, so only it sees the link.
  const canCreate = useQuery(orpc.organization.canCreate.queryOptions());

  if (destinations.isPending) return <WaveLoader label="Loading organizations" />;

  if (destinations.error)
    return <ErrorNote title="Could not load organizations" error={destinations.error} />;
  const organizations = destinations.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">Choose where to continue</h2>
        <p className="text-sm text-muted-foreground">
          Open an organization you belong to, or ask its owner for an invitation link to join
          another.
        </p>
      </div>
      {organizations.length > 0 && (
        <section aria-labelledby="your-organizations" className="flex flex-col gap-2">
          <h3
            id="your-organizations"
            className="font-mono text-sm tracking-widest text-muted-foreground"
          >
            YOUR ORGANIZATIONS
          </h3>
          <div className="flex flex-col gap-1">
            {organizations.map((organization) => (
              <Link
                key={organization.id}
                to="/$orgSlug"
                params={{ orgSlug: organization.slug }}
                className={buttonVariants({
                  variant: "ghost",
                  className: "h-10 w-full justify-start gap-3 px-2",
                })}
              >
                <Building2Icon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left text-sm">
                  {organization.name}
                </span>
                <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
        <p className="text-sm font-medium">Joining another organization?</p>
        <p className="text-sm leading-5 text-muted-foreground">
          Ask its owner for an invitation link. They can copy a pending link again from Settings →
          Members.
        </p>
      </div>
      {canCreate.data ? (
        <p className="border-t border-border pt-4 text-sm text-muted-foreground">
          Founding operator?{" "}
          <Link to="/create" className="text-foreground underline underline-offset-4">
            Create an organization
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function SwitchAccount({ email }: { email: string }) {
  const queryClient = useQueryClient();

  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();

      if (error) throw new Error(authErrorMessage(error, "Could not sign out. Try again."));
      queryClient.clear();
    },
  });

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <p className="break-all text-sm text-muted-foreground">Signed in as {email}.</p>
      <Button
        variant="link"
        className="self-start px-0"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        Switch account
      </Button>
      {signOut.error && <ErrorNote title="Could not sign out" error={signOut.error} />}
    </div>
  );
}
