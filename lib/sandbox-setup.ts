/** Bootstrap the internal Claude HTTP service inside an E2B sandbox. */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Sandbox } from "e2b";

const SERVER_DIR = "/sandbox-server";
const SERVER_PORT = 3001;
const HEALTH_TIMEOUT_MS = 60_000;
const NPM_INSTALL_TIMEOUT_MS = 180_000;
const MAX_INSTALL_ATTEMPTS = 2;

export async function bootstrapSandboxServer(
  sandbox: Sandbox
): Promise<{ baseUrl: string; token: string }> {
  await uploadServerBundle(sandbox);
  await installDependencies(sandbox);

  const token = randomUUID();
  const envs = {
    SANDBOX_SERVER_PORT: String(SERVER_PORT),
    SANDBOX_SECRET_TOKEN: token,
    ...(process.env.ANTHROPIC_BASE_URL ? { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL } : {}),
    ...(process.env.ANTHROPIC_AUTH_TOKEN ? { ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN } : {}),
    ...(process.env.ANTHROPIC_MODEL ? { ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL } : {}),
  };

  // The bracketed process name prevents pkill from matching its own command line.
  await sandbox.commands.run("pkill -f '[n]ode dist/index.js' || true", { timeoutMs: 10_000 });
  await sandbox.commands.run("node dist/index.js", {
    cwd: SERVER_DIR,
    envs,
    background: true,
    onStdout: (data) => { process.stdout.write(`[sandbox-server] ${data}`); },
    onStderr: (data) => { process.stderr.write(`[sandbox-server] ${data}`); },
  });

  const host = sandbox.getHost(SERVER_PORT);
  const baseUrl = host.startsWith("http") ? host : `https://${host}`;
  await waitForHealth(`${baseUrl}/health`);
  return { baseUrl, token };
}

async function installDependencies(sandbox: Sandbox) {
  for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt++) {
    if (await verifyClaudeBinary(sandbox)) return;
    if (attempt > 1) await sandbox.commands.run(`rm -rf ${SERVER_DIR}/node_modules ${SERVER_DIR}/package-lock.json`);

    const result = await sandbox.commands.run("npm install --omit=dev --no-audit --no-fund", {
      cwd: SERVER_DIR,
      timeoutMs: NPM_INSTALL_TIMEOUT_MS,
      onStdout: (data) => { process.stdout.write(`[sandbox npm install] ${data}`); },
      onStderr: (data) => { process.stderr.write(`[sandbox npm install] ${data}`); },
    });
    if (result.exitCode === 0 && await verifyClaudeBinary(sandbox)) return;

    if (attempt === MAX_INSTALL_ATTEMPTS) {
      throw new Error(`Unable to install a working Claude Agent SDK: ${result.stderr.slice(-2000)}`);
    }
  }
}

async function verifyClaudeBinary(sandbox: Sandbox) {
  const script = [
    "const fs=require('fs'),cp=require('child_process');",
    "const root='/sandbox-server/node_modules/@anthropic-ai';",
    "const pkg=fs.existsSync(root)&&fs.readdirSync(root).find(n=>n.startsWith('claude-agent-sdk-linux-'));",
    "if(!pkg)process.exit(1);",
    "const bin=root+'/'+pkg+'/claude';",
    "fs.accessSync(bin,fs.constants.X_OK);",
    "cp.execFileSync(bin,['--version'],{stdio:'ignore'});",
  ].join("");
  try {
    return (await sandbox.commands.run(`node -e ${JSON.stringify(script)}`, {
      cwd: SERVER_DIR,
      timeoutMs: 30_000,
    })).exitCode === 0;
  } catch {
    return false;
  }
}

async function uploadServerBundle(sandbox: Sandbox) {
  const source = await readServerBundle();
  const sourceBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  await sandbox.files.makeDir(`${SERVER_DIR}/dist`);
  await sandbox.files.write(`${SERVER_DIR}/dist/index.js`, sourceBuffer);
  await sandbox.files.write(`${SERVER_DIR}/package.json`, JSON.stringify({
    name: "sandbox-server",
    version: "1.0.0",
    private: true,
    main: "dist/index.js",
    dependencies: {
      "@anthropic-ai/claude-agent-sdk": "0.3.183",
      express: "4.21.2",
      uuid: "11.1.0",
    },
  }));
}

async function readServerBundle(): Promise<Buffer> {
  const possiblePaths = [
    path.join(process.cwd(), "lib/sandbox-server/dist/index.js"),
    path.join(process.cwd(), ".next/server/lib/sandbox-server/index.js"),
  ];
  for (const candidate of possiblePaths) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
  }
  return bundleWithEsbuild();
}

async function bundleWithEsbuild(): Promise<Buffer> {
  // Dynamic loading keeps esbuild out of the normal route-handler bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const esbuild = require("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.join(process.cwd(), "lib/sandbox-server/index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    write: false,
    external: ["@anthropic-ai/claude-agent-sdk", "express", "uuid"],
  });
  return Buffer.from(result.outputFiles[0].contents);
}

async function waitForHealth(healthUrl: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) })).ok) return;
    } catch {
      // The detached server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Sandbox server did not start within ${HEALTH_TIMEOUT_MS / 1000}s`);
}
