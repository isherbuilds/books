import { env } from "@accly/env/server";
import { ORPCError } from "@orpc/server";
import { audit } from "../audit";
import { createOrganization, createOrganizationInput } from "../core/organizations";
import { sessionProcedure } from "../lib/procedures/factory";

export const organizationRouter = {
  create: sessionProcedure.input(createOrganizationInput).handler(async ({ context, input }) => {
    const { session } = context;

    if (session.user.email.toLowerCase() !== env.FOUNDING_EMAIL.toLowerCase()) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the founding account can create organizations.",
      });
    }

    const created = await createOrganization(session.user.id, input);

    audit({
      action: "organization.create",
      actorId: session.user.id,
      orgId: created.id,
      target: `organization:${created.id}`,
      meta: { legalType: input.legalType, slug: input.slug },
    });

    return created;
  }),
};
