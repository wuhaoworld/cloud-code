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
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

// requestId → resolve callback
const pendingPermissions = new Map<
  string,
  {
    resolve: (decision: { behavior: "allow" } | { behavior: "deny"; message: string }) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

// GET /health
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
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
    // Let the SDK auto-resolve its bundled optional-dependency binary for the
    // current platform (@anthropic-ai/claude-agent-sdk-linux-x64) instead of
    // pointing at a hardcoded path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryOptions: any = {
      cwd,
      permissionMode: permissionMode ?? "default",
      enableFileCheckpointing: true,
      includePartialMessages: true,
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
