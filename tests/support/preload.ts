// Defaults only — an explicitly exported variable always wins.
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:55446/accly_test";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-0123456789abcdef";

process.env.BETTER_AUTH_URL ??= "http://localhost:55443";

process.env.CORS_ORIGIN ??= "http://localhost:55444";

process.env.FOUNDING_EMAIL ??= "founder@accly.local";

process.env.SEAWEEDFS_ENDPOINT ??= "http://localhost:55447";

process.env.SEAWEEDFS_BUCKET ??= "files";

process.env.SEAWEEDFS_ACCESS_KEY_ID ??= "better-stack";

process.env.SEAWEEDFS_SECRET_ACCESS_KEY ??= "better-stack-secret";
