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
import { randomUUID } from "crypto";
import { Writable } from "stream";

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
 * Returns the public HTTPS base URL and the shared secret token for the server.
 */
export async function bootstrapSandboxServer(
  sandbox: SandboxInstance
): Promise<{ baseUrl: string; token: string }> {
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

  // Generate a fresh per-session secret token that gates access to /stream and /approve.
  // A new token is created on every bootstrap (cold start or post-snapshot restart)
  // so leaked tokens from previous sessions can't be reused.
  const token = randomUUID();

  const envVars = [
    `SANDBOX_SERVER_PORT=${SERVER_PORT}`,
    `SANDBOX_SECRET_TOKEN=${token}`,
    process.env.ANTHROPIC_BASE_URL ? `ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL}` : "",
    process.env.ANTHROPIC_AUTH_TOKEN ? `ANTHROPIC_AUTH_TOKEN=${process.env.ANTHROPIC_AUTH_TOKEN}` : "",
    process.env.ANTHROPIC_MODEL ? `ANTHROPIC_MODEL=${process.env.ANTHROPIC_MODEL}` : "",
  ].filter(Boolean).join(" ");

  // 3. Start server in detached mode (fire-and-forget)
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", `${envVars} node dist/index.js`],
    cwd: SERVER_DIR,
    detached: true,
  });

  // 4. Wait for /health to be ready
  const baseUrl = sandbox.domain(SERVER_PORT);
  await waitForHealth(`${baseUrl}/health`);
  return { baseUrl, token };
}

/**
 * Run `npm install`, force the exec bit on the native binary, and verify the
 * binary actually launches (`claude --version`). If verification fails,
 * wipe node_modules and retry once — this recovers from a half-written
 * binary left over by a previous interrupted install (timeout, concurrent
 * bootstrap calls, sandbox reclaim mid-write, etc.).
 *
 * NOTE: We only do a local `npm install` — no global `npm install -g`.
 * The global CLI pulls in platform-specific optional deps that may resolve
 * to the wrong libc variant (e.g. musl on a glibc host), causing a
 * confusing "binary exists but failed to launch" error. The local
 * `@anthropic-ai/claude-agent-sdk` package auto-resolves the correct
 * binary for the current platform from its own optional dependencies.
 */
async function installDepsWithIntegrityCheck(sandbox: SandboxInstance): Promise<void> {
  for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt++) {
    // When resuming from a snapshot, node_modules may already exist with a
    // valid binary. Check first — skip the full install if it already works,
    // saving significant time on warm resumes.
    const alreadyWorking = await verifyClaudeBinary(sandbox);
    if (alreadyWorking) {
      process.stdout.write("[sandbox] claude binary already functional, skipping npm install\n");
      return;
    }

    // Binary is missing or broken. If node_modules already exists (e.g. from
    // a snapshot with a corrupted binary), npm install would be a no-op —
    // clean it first so the platform-specific binary gets re-downloaded.
    if (attempt > 1) {
      await cleanNodeModules(sandbox);
    }

    // Install all deps (express, uuid, claude-agent-sdk + its platform binary)
    // from the local package.json. Stream npm's output so in-progress installs
    // are visible in server logs.
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["install"],
      cwd: SERVER_DIR,
      timeoutMs: NPM_INSTALL_TIMEOUT_MS,
      stdout: prefixedLogStream(process.stdout, "[sandbox npm install] "),
      stderr: prefixedLogStream(process.stderr, "[sandbox npm install] "),
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
    // Force +x on the SDK's bundled claude binary.
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `chmod +x ${SERVER_DIR}/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude 2>/dev/null || true`,
      ],
      cwd: SERVER_DIR,
    });

    const verified = await verifyClaudeBinary(sandbox);
    if (!verified) {
      if (attempt < MAX_INSTALL_ATTEMPTS) {
        await cleanNodeModules(sandbox);
        continue;
      }
      throw new Error(
        "claude native binary exists but failed to launch after reinstall attempt. " +
          "This may indicate a corrupted download, insufficient disk space, or an " +
          "actual libc mismatch in the sandbox image."
      );
    }

    // Make claude available globally so it can be found via `which claude`.
    // Prefer ~/.local/bin (user-owned, always in PATH on Vercel Sandbox VMs).
    // Fall back to /usr/local/bin if needed.
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p ~/.local/bin && ln -sf ${SERVER_DIR}/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude ~/.local/bin/claude`,
      ],
    });

    return;
  }
}

/**
 * Verify the claude native binary can actually execute, by running
 * `claude --version` against the SDK's locally installed binary.
 * Returns false if the binary is missing, not executable, or crashes
 * on launch (e.g. truncated file, libc mismatch).
 */
async function verifyClaudeBinary(sandbox: SandboxInstance): Promise<boolean> {
  const binPath = `${SERVER_DIR}/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude`;
  try {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `[ -x "${binPath}" ] && "${binPath}" --version`],
      cwd: SERVER_DIR,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Wrap a target Node stream (e.g. process.stdout) in a Writable that
 * prefixes every chunk before forwarding it. Used to tag streamed npm
 * install output in server logs so it's clear which sandbox operation
 * produced it, without needing a real per-request logger.
 */
function prefixedLogStream(target: NodeJS.WritableStream, prefix: string): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      target.write(prefix + chunk.toString());
      callback();
    },
  });
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
  // Pin to the exact version used locally (see package.json) so sandbox
  // cold-starts (fresh create, or snapshot-expired rebuild) always install
  // the same SDK version we developed/tested against. "latest" would let
  // the in-sandbox version silently drift out from under the local one,
  // making bugs hard to reproduce.
  const pkg = JSON.stringify({
    name: "sandbox-server",
    version: "1.0.0",
    main: "dist/index.js",
    dependencies: {
      express: "^4.21.0",
      uuid: "^11.0.0",
      "@anthropic-ai/claude-agent-sdk": "0.3.183",
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
    external: ["@anthropic-ai/claude-agent-sdk", "express", "uuid"],
  });
  return Buffer.from(result.outputFiles[0].contents);
}

/**
 * Restart the in-sandbox server if it's not already running.
 * Checks /health first — skips the full bootstrap if the server is already alive.
 * Used in the onResume callback after a sandbox is restored from snapshot.
 *
 * NOTE: Because the server process is restarted with a new SANDBOX_SECRET_TOKEN
 * on every resume, the caller must update its cached token.
 */
export async function restartServerIfStopped(
  sandbox: SandboxInstance
): Promise<{ baseUrl: string; token: string }> {
  const baseUrl = sandbox.domain(SERVER_PORT);

  // Quick health check — if the server survived the resume, skip bootstrap
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      // Server is still alive. We can't recover the original token from a
      // running process, so do a full re-bootstrap to get a fresh token.
      // This path is rare (server surviving a VM resume), and the bootstrap
      // skips npm install when the binary is already functional.
    }
  } catch {
    // Not running, proceed with bootstrap
  }

  return bootstrapSandboxServer(sandbox);
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
