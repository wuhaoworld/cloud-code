/**
 * Bootstrap logic for the Vercel Sandbox VM.
 * Called by SandboxManager.ensureServerRunning() after the sandbox is created.
 *
 * Steps:
 *   1. Write the bundled server source into the sandbox at /sandbox-server/
 *   2. npm install required deps
 *   3. Start the server (detached, port 3001)
 *   4. Wait for /health to respond
 */

import path from "path";
import fs from "fs";

type SandboxInstance = InstanceType<typeof import("@vercel/sandbox").Sandbox>;

const SERVER_DIR = "/sandbox-server";
const SERVER_PORT = 3001;
const HEALTH_TIMEOUT_MS = 60_000;

/**
 * Install dependencies and start the HTTP server inside the sandbox.
 * Idempotent — safe to call if server is already running.
 * Returns the public HTTPS base URL for the server.
 */
export async function bootstrapSandboxServer(sandbox: SandboxInstance): Promise<string> {
  // 1. Upload server bundle
  await uploadServerBundle(sandbox);

  // 2. Install production deps inside the sandbox
  await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--omit=dev"],
    cwd: SERVER_DIR,
  });

  // 3. Start server in detached mode (fire-and-forget)
  await sandbox.runCommand({
    cmd: "node",
    args: ["dist/index.js"],
    cwd: SERVER_DIR,
    detached: true,
    env: { SANDBOX_SERVER_PORT: String(SERVER_PORT) },
  });

  // 4. Wait for /health to be ready
  const baseUrl = sandbox.domain(SERVER_PORT);
  await waitForHealth(`${baseUrl}/health`);
  return baseUrl;
}

async function uploadServerBundle(sandbox: SandboxInstance): Promise<void> {
  // The compiled server JS lives next to this file after build.
  // In development we use ts-node/esbuild; in production the bundler
  // outputs to lib/sandbox-server/dist/index.js.
  const possiblePaths = [
    path.join(process.cwd(), "lib/sandbox-server/dist/index.js"),
    path.join(process.cwd(), ".next/server/lib/sandbox-server/index.js"),
  ];

  let source: Buffer | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      source = fs.readFileSync(p);
      break;
    }
  }

  if (!source) {
    // Fallback: compile on-the-fly with esbuild (available in Node environment)
    source = await bundleWithEsbuild();
  }

  // Create directory and write files
  await sandbox.runCommand({ cmd: "mkdir", args: ["-p", `${SERVER_DIR}/dist`] });

  await sandbox.fs.writeFile(`${SERVER_DIR}/dist/index.js`, source);

  // Write minimal package.json so npm install works.
  // Explicitly include the musl variant because Vercel Sandbox VMs run Alpine Linux (musl libc).
  // Without this, npm may install the glibc linux-x64 optional dep instead, which fails to launch.
  const pkg = JSON.stringify({
    name: "sandbox-server",
    version: "1.0.0",
    main: "dist/index.js",
    dependencies: {
      express: "^4.21.0",
      uuid: "^11.0.0",
      "@anthropic-ai/claude-agent-sdk": "latest",
      "@anthropic-ai/claude-agent-sdk-linux-x64-musl": "latest",
    },
  });
  await sandbox.fs.writeFile(`${SERVER_DIR}/package.json`, pkg);
}

async function bundleWithEsbuild(): Promise<Buffer> {
  // Dynamic import so esbuild is only needed at bootstrap time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const esbuild = require("esbuild");
  // __dirname is a virtual path in Next.js compiled code; use process.cwd() instead
  const entryPoint = path.join(process.cwd(), "lib/sandbox-server/index.ts");
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    write: false,
    external: ["@anthropic-ai/claude-agent-sdk"],
  });
  return Buffer.from(result.outputFiles[0].contents);
}

async function waitForHealth(healthUrl: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Sandbox server did not start within ${HEALTH_TIMEOUT_MS / 1000}s`);
}
