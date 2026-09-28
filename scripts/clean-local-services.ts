import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CONFIRM_FLAG = "--confirm-delete-local-volumes";

const COMPOSE_FILE = resolve(import.meta.dir, "../packages/db/docker-compose.dev.yaml");

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} exited with status ${result.status}`);
  }

  return result.stdout.trim();
}

function assertLocalDockerContext(): void {
  const context = run("docker", ["context", "show"]);

  const rawEndpoint = run("docker", [
    "context",
    "inspect",
    "--format",
    "{{json .Endpoints.docker}}",
    context,
  ]);

  const endpoint: unknown = JSON.parse(rawEndpoint);

  if (
    typeof endpoint !== "object" ||
    endpoint === null ||
    !("Host" in endpoint) ||
    typeof endpoint.Host !== "string" ||
    !/^(unix|npipe):\/\//.test(endpoint.Host)
  ) {
    throw new Error(
      `Docker context "${context}" is not local. No containers or volumes were removed.`,
    );
  }
}

if (!process.argv.includes(CONFIRM_FLAG)) {
  console.error(
    `This stops the local PostgreSQL and SeaweedFS containers and deletes their volumes.\n` +
      `To confirm, run: bun run db:down:clean -- ${CONFIRM_FLAG}`,
  );
  process.exitCode = 1;
} else {
  assertLocalDockerContext();
  console.info("Stopping local PostgreSQL and SeaweedFS; deleting accly-db-dev volumes.");

  const result = spawnSync(
    "docker",
    [
      "compose",
      "--project-name",
      "accly-db-dev",
      "--file",
      COMPOSE_FILE,
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { stdio: "inherit" },
  );

  if (result.error) throw result.error;

  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
