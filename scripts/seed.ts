import { createOrganization, createOrganizationInput } from "@accly/api/core/organizations";
import { auth } from "@accly/auth";
import type { RoleKey } from "@accly/auth/access";
import { createUserWithPassword } from "@accly/auth/manual-user";
import { db } from "@accly/db";
import { runMigrations } from "@accly/db/migrate";
import { member, user } from "@accly/db/schema/auth";
import { env } from "@accly/env/server";
import { count, eq } from "drizzle-orm";
import pg from "pg";

// bun run db:seed, or `-- --reset` to drop the schema first. Refuses to touch a
// production database. Every account is created with `createUserWithPassword`,
// exactly as an operator would, because sign-up is disabled.

const PASSWORD = "password123";

type Person = {
  email: string;
  name: string;
  id: string;
  headers: Headers;
};

// `NODE_ENV` defaults to `development`, so it cannot be the only thing standing
// between `--reset` and a real database. Gate on the database name and fail loud.
const RESETTABLE_DATABASE = /^(postgres|.*_dev|.*_test)$/;

function assertResettableDatabase(): void {
  const name = new URL(env.DATABASE_URL).pathname.slice(1);

  if (!RESETTABLE_DATABASE.test(name)) {
    throw new Error(
      `Refusing to drop the schema of database "${name}". ` +
        "--reset only runs against a database named postgres, *_dev or *_test.",
    );
  }
}

async function resetSchema(): Promise<void> {
  assertResettableDatabase();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      "drop schema public cascade; create schema public; drop schema if exists drizzle cascade;",
    );
  } finally {
    await client.end();
  }

  await runMigrations();
}

async function createUser(email: string, name: string): Promise<Person> {
  const { id } = await createUserWithPassword({ email, name, password: PASSWORD });

  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });

  const cookie = headers.get("set-cookie")?.split(";")[0];

  if (!cookie) {
    throw new Error(`Sign-in for ${email} returned no session cookie`);
  }

  return { email, name, id, headers: new Headers({ cookie }) };
}

async function addMember(
  organizationId: string,
  person: Person,
  role: RoleKey = "reception",
): Promise<void> {
  await auth.api.addMember({
    body: { userId: person.id, organizationId, role },
  });
}

async function createOrg(owner: Person, name: string, slug: string): Promise<string> {
  const org = await createOrganization(
    owner.id,
    createOrganizationInput.parse({
      name,
      slug,
      legalType: "company",
      legalName: name,
      pan: "AAACM1234A",
      stateCode: "27",
      addressLine1: "12 Business Road",
      city: "Pune",
      pinCode: "411001",
    }),
  );

  return org.id;
}

async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const reset = process.argv.includes("--reset");

  if (reset) {
    console.info("Dropping and re-migrating the schema…");
    await resetSchema();
  }

  const [existing] = await db.select({ value: count() }).from(user);

  if (existing && existing.value > 0) {
    console.info(
      `Database already has ${existing.value} user(s); leaving it alone.\n` +
        "Re-run with `bun run db:seed -- --reset` to wipe and reseed.",
    );

    return;
  }

  const owner = await createUser("owner@example.com", "Ada Lovelace");
  const meridian = await createOrg(owner, "Meridian Traders", "meridian-traders");
  await createOrg(owner, "Ridgeview Academy", "ridgeview-academy");

  const admin = await createUser("admin@example.com", "Grace Hopper");
  const staff = await createUser("staff@example.com", "Alan Turing");
  await addMember(meridian, admin, "admin");
  await addMember(meridian, staff);

  // Left unaccepted, so the Members page shows an invited row on arrival.
  await auth.api.createInvitation({
    body: { email: "invited@example.com", role: "reception", organizationId: meridian },
    headers: owner.headers,
  });

  const [meridianCount] = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, meridian));

  console.info(
    [
      "",
      "Seeded.",
      "",
      `  Password for every account below: ${PASSWORD}`,
      "",
      "  owner@example.com   owner   Meridian Traders + Ridgeview Academy",
      "  admin@example.com   admin   Meridian Traders",
      "  staff@example.com   reception  Meridian Traders",
      "",
      `  Meridian Traders  ${meridianCount?.value ?? 0} members, 1 pending invitation`,
      "  Ridgeview Academy       1 member",
      "",
      "  Sign in as owner@example.com to switch between both orgs.",
      "  admin@example.com can read the audit log;",
      "  staff@example.com cannot — that denial is itself audited.",
      "",
      "  New accounts are created by an operator:",
      "  bun run create-user <email> <name> <password>",
      "",
      `  ${env.CORS_ORIGIN}/login`,
      "",
    ].join("\n"),
  );
}

await main();

process.exit(0);
