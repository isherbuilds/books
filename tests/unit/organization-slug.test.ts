import { expect, test } from "bun:test";

import { organizationSlugIssue } from "@accly/auth/organization-slug";

test("organization slugs require at least four URL-safe characters", () => {
  expect(organizationSlugIssue("abc")).not.toBeNull();
  expect(organizationSlugIssue("abcd")).toBeNull();
  expect(organizationSlugIssue("1234")).toBeNull();
  expect(organizationSlugIssue("meridian-traders")).toBeNull();
  expect(organizationSlugIssue("Meridian Traders")).not.toBeNull();
});

test("organization slugs fit one DNS label", () => {
  expect(organizationSlugIssue("a".repeat(63))).toBeNull();
  expect(organizationSlugIssue("a".repeat(64))).not.toBeNull();
});

test("public and system root routes are reserved case-insensitively", () => {
  for (const slug of [
    "create",
    "DOCS",
    "blog",
    "pricing",
    "security",
    "developers",
    "support",
    "org",
    "workspace",
    "customers",
    "records",
    "reports",
    "files",
    "emergency",
    "faq",
  ]) {
    expect(organizationSlugIssue(slug)).not.toBeNull();
  }
});
