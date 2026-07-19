/**
 * HTTP server that runs INSIDE the Vercel Sandbox VM.
 * Started by sandbox-setup.ts after deps are installed.
 *
 * Routes:
 *   POST /stream   — run claude-agent-sdk query() and stream SSE back
 *   POST /approve  — resolve a pending permission request
 *   GET  /health   — liveness probe
 */

import express, { Request, Response } from "express";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Bearer token authentication
// ---------------------------------------------------------------------------
// SANDBOX_SECRET_TOKEN is injected by sandbox-setup.ts at server start time.
// If unset (local dev without the env var), we log a warning and skip auth.
const SANDBOX_SECRET_TOKEN = process.env.SANDBOX_SECRET_TOKEN ?? "";
if (!SANDBOX_SECRET_TOKEN) {
  process.stderr.write(
    "[sandbox-server] WARNING: SANDBOX_SECRET_TOKEN is not set — all endpoints are unauthenticated!\n"
  );
}

// Middleware: require Authorization: Bearer <token> on all routes except /health.
app.use((req: Request, res: Response, next: import("express").NextFunction) => {
  // /health is exempt — it's the startup probe called before the token is known
  if (req.path === "/health") {
    next();
    return;
  }
  // If no token is configured, skip verification (dev fallback)
  if (!SANDBOX_SECRET_TOKEN) {
    next();
    return;
  }
  const authHeader = req.headers["authorization"] ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (provided !== SANDBOX_SECRET_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// requestId → resolve callback
const pendingPermissions = new Map<
  string,
  {
    resolve: (decision: { behavior: "allow" } | { behavior: "deny"; message: string }) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

const SANDBOX_SERVER_VERSION = 3;
const WORKSPACE_ROOT = "/workspace";
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "out", "build", ".cache",
  ".turbo", ".pnpm", "coverage", "__pycache__", ".venv", "venv",
]);
const MAX_FILE_TREE_DEPTH = 6;
const MAX_FILE_TREE_ENTRIES = 1_000;

type ProjectFileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: ProjectFileNode[];
};

// GET /health
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, version: SANDBOX_SERVER_VERSION });
});

// POST /files — enumerate one project's directory inside this Sandbox VM.
app.post("/files", (req: Request, res: Response) => {
  const { projectPath, q = "", tree = false } = req.body as {
    projectPath?: string;
    q?: string;
    tree?: boolean;
  };

  // Project paths stored for Sandbox projects are single directory names.
  // Revalidate at this trust boundary before constructing an OS path.
  if (typeof projectPath !== "string" || !/^[a-zA-Z0-9_-]+$/.test(projectPath)) {
    res.status(400).json({ error: "Invalid project path" });
    return;
  }

  const rootPath = path.resolve(WORKSPACE_ROOT, projectPath);
  if (path.dirname(rootPath) !== WORKSPACE_ROOT) {
    res.status(400).json({ error: "Invalid project path" });
    return;
  }

  try {
    const rootStats = fs.lstatSync(rootPath);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      res.status(404).json({ error: "Project directory not found" });
      return;
    }
  } catch {
    res.status(404).json({ error: "Project directory not found" });
    return;
  }

  const files: string[] = [];
  const fileTree: ProjectFileNode[] = [];

  function walk(
    directory: string,
    relativePath: string,
    depth: number,
    nodes: ProjectFileNode[],
  ) {
    if (depth > MAX_FILE_TREE_DEPTH || files.length >= MAX_FILE_TREE_ENTRIES) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      const directoryOrder = Number(b.isDirectory()) - Number(a.isDirectory());
      return directoryOrder || a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const children: ProjectFileNode[] = [];
        nodes.push({ name: entry.name, path: entryPath, type: "directory", children });
        files.push(`${entryPath}/`);
        walk(path.join(directory, entry.name), entryPath, depth + 1, children);
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, path: entryPath, type: "file" });
        files.push(entryPath);
      }

      if (files.length >= MAX_FILE_TREE_ENTRIES) break;
    }
  }

  walk(rootPath, "", 0, fileTree);

  if (tree) {
    res.json({ tree: fileTree });
    return;
  }

  const query = typeof q === "string" ? q.toLowerCase() : "";
  const filtered = query
    ? files.filter((file) => file.toLowerCase().includes(query)).slice(0, 20)
    : files.slice(0, 20);
  res.json({ files: filtered });
});

// POST /approve — permission decision forwarded from Next.js
app.post("/approve", (req: Request, res: Response) => {
  const { requestId, behavior, message } = req.body as {
    requestId: string;
    behavior: "allow" | "deny";
    message?: string;
  };

  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    res.status(404).json({ error: "Permission request not found or already resolved" });
    return;
  }

  pendingPermissions.delete(requestId);
  clearTimeout(pending.timeout);
  pending.resolve(
    behavior === "allow"
      ? { behavior: "allow" }
      : { behavior: "deny", message: message ?? "Permission denied." }
  );
  res.json({ ok: true });
});

const MAX_TERMINAL_COMMAND_LENGTH = 10_000;
const MAX_TERMINAL_OUTPUT_BYTES = 1_000_000;
const TERMINAL_COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;

type TerminalExecution = {
  child: ChildProcess;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
};

const runningTerminalCommands = new Map<string, TerminalExecution>();
const runningTerminalProjects = new Map<string, string>();

function getTerminalProjectRoot(projectPath: unknown): string | null {
  if (typeof projectPath !== "string" || !/^[a-zA-Z0-9_-]+$/.test(projectPath)) {
    return null;
  }

  const rootPath = path.resolve(WORKSPACE_ROOT, projectPath);
  if (path.dirname(rootPath) !== WORKSPACE_ROOT) return null;

  try {
    const stats = fs.lstatSync(rootPath);
    return stats.isDirectory() && !stats.isSymbolicLink() ? rootPath : null;
  } catch {
    return null;
  }
}

function terminateTerminalCommand(executionId: string, signal: NodeJS.Signals = "SIGTERM") {
  const execution = runningTerminalCommands.get(executionId);
  if (!execution || execution.child.killed) return false;

  try {
    // The command runs as its own process group so a cancellation also stops
    // descendants such as npm, rather than leaving them running in the VM.
    if (execution.child.pid) {
      process.kill(-execution.child.pid, signal);
    } else {
      execution.child.kill(signal);
    }
    return true;
  } catch {
    try {
      execution.child.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

// POST /terminal/cancel — terminate an active command for this workspace Sandbox.
app.post("/terminal/cancel", (req: Request, res: Response) => {
  const executionId = (req.body as { executionId?: unknown }).executionId;
  if (typeof executionId !== "string" || !executionId) {
    res.status(400).json({ error: "executionId is required" });
    return;
  }

  if (!runningTerminalCommands.has(executionId)) {
    res.status(404).json({ error: "Terminal command not found or already completed" });
    return;
  }

  terminateTerminalCommand(executionId);
  res.json({ ok: true });
});

// POST /terminal/exec — execute one non-interactive shell command and stream output as SSE.
app.post("/terminal/exec", (req: Request, res: Response) => {
  const { projectPath, command } = req.body as {
    projectPath?: unknown;
    command?: unknown;
  };
  const rootPath = typeof projectPath === "string"
    ? getTerminalProjectRoot(projectPath)
    : null;

  if (typeof projectPath !== "string" || !rootPath) {
    res.status(400).json({ error: "Invalid project path" });
    return;
  }
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > MAX_TERMINAL_COMMAND_LENGTH ||
    command.includes("\0")
  ) {
    res.status(400).json({ error: "A valid command up to 10,000 characters is required" });
    return;
  }
  if (runningTerminalProjects.has(projectPath)) {
    res.status(409).json({ error: "Another terminal command is already running for this project" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const executionId = uuidv4();
  const startedAt = Date.now();
  let outputBytes = 0;
  let outputLimited = false;
  let finished = false;

  const emit = (eventType: string, data: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    const execution = runningTerminalCommands.get(executionId);
    if (execution) clearTimeout(execution.timeout);
    runningTerminalCommands.delete(executionId);
    runningTerminalProjects.delete(projectPath);
    if (!res.writableEnded) res.end();
  };
  const emitOutput = (eventType: "stdout" | "stderr", chunk: Buffer) => {
    if (outputLimited) return;

    const remaining = MAX_TERMINAL_OUTPUT_BYTES - outputBytes;
    if (remaining <= 0) {
      outputLimited = true;
      emit("error", { executionId, message: "Command output exceeded the 1 MB limit" });
      terminateTerminalCommand(executionId);
      return;
    }

    const limitedChunk = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    outputBytes += limitedChunk.byteLength;
    emit(eventType, { executionId, data: limitedChunk.toString("utf8") });

    if (chunk.byteLength > remaining) {
      outputLimited = true;
      emit("error", { executionId, message: "Command output exceeded the 1 MB limit" });
      terminateTerminalCommand(executionId);
    }
  };

  const child = spawn("/bin/bash", ["-lc", command], {
    cwd: rootPath,
    detached: true,
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      LANG: process.env.LANG ?? "C.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
      TERM: "dumb",
      PWD: rootPath,
      NODE_ENV: process.env.NODE_ENV ?? "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    emit("error", { executionId, message: "Command timed out after 5 minutes" });
    if (terminateTerminalCommand(executionId)) {
      setTimeout(() => terminateTerminalCommand(executionId, "SIGKILL"), 5_000).unref();
    }
  }, TERMINAL_COMMAND_TIMEOUT_MS);

  runningTerminalCommands.set(executionId, { child, startedAt, timeout });
  runningTerminalProjects.set(projectPath, executionId);
  emit("started", { executionId, cwd: rootPath });

  child.stdout?.on("data", (chunk: Buffer) => emitOutput("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => emitOutput("stderr", chunk));
  child.once("error", (error) => {
    emit("error", { executionId, message: error.message });
    finish();
  });
  child.once("close", (exitCode, signal) => {
    const durationMs = Date.now() - (runningTerminalCommands.get(executionId)?.startedAt ?? Date.now());
    emit("exit", {
      executionId,
      exitCode: typeof exitCode === "number" ? exitCode : null,
      signal: signal ?? null,
      durationMs,
    });
    finish();
  });

  // Browser aborts and explicit cancellations both close the streaming response.
  // Stop the process group so it cannot outlive its visible terminal session.
  res.once("close", () => {
    if (runningTerminalCommands.has(executionId)) {
      terminateTerminalCommand(executionId);
    }
  });
});

// POST /stream — SSE response
app.post("/stream", async (req: Request, res: Response) => {
  const {
    prompt,
    cwd,
    sessionId,
    model,
    permissionMode,
  } = req.body as {
    prompt: string;
    cwd: string;
    sessionId?: string;
    model?: string;
    permissionMode?: string;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (eventType: string, data: Record<string, unknown>) => {
    try {
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client disconnected
    }
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { query } = require("@anthropic-ai/claude-agent-sdk");

    // Vercel Sandbox VMs boot an Amazon Linux 2023 image (glibc), not Alpine/musl.
    // Explicitly point the SDK at the glibc-linked linux-x64 binary that was
    // installed and verified by sandbox-setup.ts. Without this, the SDK's own
    // auto-resolution logic (which walks import.meta.url to locate the optional
    // dependency package) can pick the wrong libc variant or fail with
    // "exists but failed to launch" even when the correct binary is on disk.
    const CLAUDE_BIN = "/sandbox-server/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryOptions: any = {
      cwd,
      pathToClaudeCodeExecutable: CLAUDE_BIN,
      permissionMode: permissionMode ?? "default",
      enableFileCheckpointing: true,
      includePartialMessages: true,
      // Forward custom Anthropic endpoint / key / model from the process environment
      // (injected by sandbox-setup.ts when the server is started).
      // Spreading process.env preserves PATH and other required vars inherited by
      // the claude subprocess.
      env: {
        ...process.env,
        ...(process.env.ANTHROPIC_BASE_URL ? { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL } : {}),
        ...(process.env.ANTHROPIC_AUTH_TOKEN ? { ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN } : {}),
        ...(process.env.ANTHROPIC_MODEL && !model ? { ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL } : {}),
      },
      ...(model ? { model } : {}),
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        options: { toolUseID: string; signal: AbortSignal; [k: string]: unknown }
      ) => {
        const requestId = uuidv4();

        emit("permission_request", {
          requestId,
          toolUseId: options.toolUseID,
          toolName,
          input,
          title: options.title,
          displayName: options.displayName,
          description: options.description,
          blockedPath: options.blockedPath,
          decisionReason: options.decisionReason,
        });

        const decision = await new Promise<
          { behavior: "allow" } | { behavior: "deny"; message: string }
        >((resolve) => {
          const timeout = setTimeout(() => {
            if (pendingPermissions.has(requestId)) {
              pendingPermissions.delete(requestId);
              resolve({ behavior: "deny", message: "Permission request timed out." });
            }
          }, 5 * 60 * 1000);

          const abort = () => {
            if (pendingPermissions.has(requestId)) {
              clearTimeout(timeout);
              pendingPermissions.delete(requestId);
              resolve({ behavior: "deny", message: "Permission request was cancelled." });
            }
          };
          options.signal.addEventListener("abort", abort, { once: true });

          pendingPermissions.set(requestId, {
            resolve: (value) => {
              options.signal.removeEventListener("abort", abort);
              resolve(value);
            },
            timeout,
          });
        });

        emit("permission_resolved", { requestId, behavior: decision.behavior });

        if (decision.behavior === "deny") {
          return { behavior: "deny", message: (decision as { behavior: "deny"; message: string }).message };
        }
        return { behavior: "allow", updatedInput: input };
      },
    };

    if (sessionId) {
      queryOptions.resume = sessionId;
    }

    // Forward all SDK messages as SSE events (same schema as the Next.js route)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const message of query({ prompt, options: queryOptions }) as any) {
      // Re-emit each message as a typed SSE event so the Next.js proxy can
      // forward them verbatim to the browser.
      emit("sdk_message", { message });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    emit("error", { message: errMsg });
  } finally {
    res.end();
  }
});

const PORT = parseInt(process.env.SANDBOX_SERVER_PORT ?? "3001", 10);
app.listen(PORT, () => {
  process.stdout.write(`sandbox-server ready on port ${PORT}\n`);
});
