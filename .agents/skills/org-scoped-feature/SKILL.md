---
name: org-scoped-feature
description: >-
  Add or change an organization-scoped domain in this repo — schema, migration, permission,
  oRPC router, route, and the tenancy test. Use whenever work touches a table with orgId, a
  procedure declared with orgProcedure, packages/auth/src/access.ts, or a page under
  apps/web/src/routes/$orgSlug/.
---

# Add an org-scoped feature

Every domain row belongs to exactly one organization. This skill is the
end-to-end path for a new one. Background:
[tenancy and authorization](../../../docs/architecture.md#tenancy-and-authorization)
and the hard rules in `AGENTS.md`, which apply to every step. This skill adds
only the order, the templates, and the checks those rules do not state.

Work in this order — each step depends on the one before it.

## 1. Schema — `packages/db/src/schema/<thing>.ts`

```ts
export const thing = pgTable(
  "thing",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("thing_org_created_idx").on(table.orgId, table.createdAt.desc(), table.id.desc()),
  ],
);
```

- `orgId` cascades from the org.
- The index leads with `orgId`, then the sort and keyset columns in query order.
- Export it from `packages/db/src/schema/index.ts`.

## 2. Migration

```sh
bun run db:generate
```

Hard rule 4 applies.

## 3. Permission — `packages/auth/src/access.ts`

Add the statement to `ac`, then grant it to each of `owner`, `accountant`, `ca`
and `operator` that should have it.

```ts
export const ac = createAccessControl({ ..., thing: ["create", "read", "update", "delete"] } as const);
```

## 4. Router — `packages/api/src/routers/<thing>.ts`

```ts
export const thingRouter = {
  list: orgProcedure(
    { thing: ["read"] },
    orgInput.extend({ cursor: ..., limit: z.number().int().min(1).max(100).default(50) }),
  ).handler(async ({ context, input }) => {
    return db.select().from(thing).where(eq(thing.orgId, context.scope.orgId)) /* ... */;
  }),
};
```

Beyond hard rules 1 and 2:

- The tenant predicate also goes on queries that already filter by primary key.
  This is what makes a foreign id a `NOT_FOUND` instead of a leak.
- Mutations are a single scoped `UPDATE`/`DELETE ... RETURNING`, not
  select-then-write. Missing direct writes return `NOT_FOUND`; conditional state
  writes may collapse missing and stale rows into one `CONFLICT`.
- Keyset pagination, never `OFFSET`.
- An unverified foreign org claim must never write into that tenant's audit
  trail. Audit additional domain denials only after scope is proven.

Register it in `packages/api/src/routers/index.ts`.

## 5. Route — `apps/web/src/routes/$orgSlug/<thing>.tsx`

Hard rule 2 and the UI section of `AGENTS.md` cover the route. Import `orpc` from
`@/lib/orpc` and read `orgSlug` from route params. Use only the state colours and
named exceptions documented in [Design](../../../docs/design.md); tenants do not
receive their own visual themes.

## 6. Test — `tests/integration/tenancy.test.ts`

Add a `GUARDED_CALLS` entry for each new procedure. The suite fails if an
org-scoped procedure lacks one, and it proves the foreign-org and removed-member
refusals for every entry. Hand-write a test only for a domain-specific leak, with
`createTestUser`, `createOrganization`, `joinOrganization`, `clientFor` and
`expectORPCCode`. Assert oRPC codes, not message text.

## 7. Gate

Run `bun run check-types`, then `bun run test` for the tenancy test. `test` wipes
`accly_test`, and only one session at a time may run it. Other checks follow
[Development: Commands](../../../docs/development.md#commands).

## Self-check before calling it done

- [ ] Hard rules 1, 2, 4 and 5 hold for every file touched.
- [ ] Edit-token columns are `timestamptz(3)`, and writes set them with `nextEditToken` (`lib/conflict.ts`).
- [ ] Each new procedure has a `GUARDED_CALLS` entry in the tenancy test.
- [ ] Behaviour that changed has its doc updated in the same change.
