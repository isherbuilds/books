// Shared by the browser benchmarks: runs one chrome-devtools-axi command in a named
// session and reads back the JSON an `eval` returned.

export async function axi(
  env: Record<string, string | undefined>,
  args: string[],
  tolerateFailure = false,
): Promise<string> {
  const process = Bun.spawn(["./node_modules/.bin/chrome-devtools-axi", ...args], {
    cwd: import.meta.dir + "/..",
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0 && !tolerateFailure) {
    throw new Error(`chrome-devtools-axi ${args[0]} failed: ${stderr || stdout}`);
  }

  return stdout;
}

export function parseEvalResult(output: string): Record<string, unknown> {
  const line = output.split("\n").find((candidate) => candidate.startsWith("result: "));

  if (!line) throw new Error(`No eval result in:\n${output}`);
  const encoded = JSON.parse(line.slice("result: ".length));

  return JSON.parse(encoded);
}
