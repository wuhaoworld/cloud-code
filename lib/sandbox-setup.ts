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
// The claude native binary is ~250MB. npm install can take a while on a cold
// sandbox; give it a generous but bounded timeout so a stalled install never
// hangs the request indefinitely, and so we can reliably detect+retry a
// truly stuck install instead of leaving a half-written binary behind.
const NPM_INSTALL_TIMEOUT_MS = 180_000;
const MAX_INSTALL_ATTEMPTS = 2;

/**
 * Install dependencies and start the HTTP server inside the sandbox.
 * Idempotent — safe to call if server is already running.
 * Returns the public HTTPS base URL for the server.
 */
export async function bootstrapSandboxServer(sandbox: SandboxInstance): Promise<string> {
  // 1. Upload server bundle
  await uploadServerBundle(sandbox);

  // 2. Install production deps inside the sandbox, verifying the native
  // `claude` binary actually works afterwards. If a previous run was
  // interrupted mid-write (timeout, sandbox reclaim, concurrent caller),
  // the binary can be left on disk with correct permissions but truncated/
  // corrupted content — `existsSync()` still passes, but spawning it fails
  // with a confusing "exists but failed to launch" error. Detect that case
  // and force a clean reinstall instead of surfacing the cryptic error.
  await installDepsWithIntegrityCheck(sandbox);

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

/**
 * Run `npm install`, force the exec bit on the native binary, and verify the
 * binary actually launches (`claude --version`). If verification fails,
 * wipe node_modules and retry once — this recovers from a half-written
 * binary left over by a previous interrupted install (timeout, concurrent
 * bootstrap calls, sandbox reclaim mid-write, etc.).
 */
async function installDepsWithIntegrityCheck(sandbox: SandboxInstance): Promise<void> {
  for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt++) {
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "--omit=dev"],
      cwd: SERVER_DIR,
      timeoutMs: NPM_INSTALL_TIMEOUT_MS,
    });

    if (install.exitCode !== 0) {
      if (attempt < MAX_INSTALL_ATTEMPTS) {
        await cleanNodeModules(sandbox);
        continue;
      }
      const stderr = await install.stderr().catch(() => "");
      throw new Error(`npm install failed in sandbox (exit ${install.exitCode}): ${stderr.slice(-2000)}`);
    }

    // Safety net: some npm/tar extraction paths (e.g. certain registries or
    // proxies) don't preserve the executable bit on large native binaries.
    // Force +x on the claude binary so a stripped exec bit doesn't surface as a
    // confusing "binary exists but failed to launch" / libc-mismatch error.
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `chmod +x ${SERVER_DIR}/node_modules/@anthropic-ai/claude-agent-sdk-*/claude 2>/dev/null || true`,
      ],
      cwd: SERVER_DIR,
    });

    const verified = await verifyClaudeBinary(sandbox);
    if (verified) return;

    if (attempt < MAX_INSTALL_ATTEMPTS) {
      // Binary exists but won't launch — most likely a truncated/corrupted
      // file from an interrupted previous install. Wipe and reinstall clean
      // rather than propagating the cryptic SDK error to the caller.
      await cleanNodeModules(sandbox);
      continue;
    }

    throw new Error(
      "claude native binary exists but failed to launch after reinstall attempt. " +
        "This may indicate a corrupted download, insufficient disk space, or an " +
        "actual libc mismatch in the sandbox image."
    );
  }
}

/**
 * Verify the claude native binary can actually execute, by running
 * `claude --version`. Returns false if the binary is missing, not
 * executable, or crashes on launch (e.g. truncated file).
 */
async function verifyClaudeBinary(sandbox: SandboxInstance): Promise<boolean> {
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `bin=$(ls ${SERVER_DIR}/node_modules/@anthropic-ai/claude-agent-sdk-*/claude 2>/dev/null | head -1); ` +
        `[ -n "$bin" ] && "$bin" --version >/dev/null 2>&1`,
    ],
  });
  return result.exitCode === 0;
}

async function cleanNodeModules(sandbox: SandboxInstance): Promise<void> {
  await sandbox.runCommand({
    cmd: "rm",
    args: ["-rf", `${SERVER_DIR}/node_modules`, `${SERVER_DIR}/package-lock.json`],
  });
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
  // Vercel Sandbox VMs boot an Amazon Linux 2023 image (glibc), so npm's platform
  // resolution will correctly pull in the linux-x64 (glibc) optional dependency of
  // the main SDK package on its own — no need to pin a musl variant.
  const pkg = JSON.stringify({
    name: "sandbox-server",
    version: "1.0.0",
    main: "dist/index.js",
    dependencies: {
      express: "^4.21.0",
      uuid: "^11.0.0",
      "@anthropic-ai/claude-agent-sdk": "latest",
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
