import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects, projectSessions, chatMessages, workspaces } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { Block } from "@/store/types";
import { isPermissionMode } from "@/lib/permission-mode";
import {
  getAllowedSessionPermissionUpdates,
  clearSessionPermissionUpdates,
  pendingPermissions,
  toPermissionResult,
} from "@/lib/pending-permissions";
import { validateProjectDirectory } from "@/lib/project-path";
import { SandboxManager } from "@/lib/sandbox-manager";
import { sandboxStreamProxy } from "@/lib/sandbox-proxy";

interface PendingMessage {
  id: string;
  role: "user" | "assistant";
  blocks: Block[];
  sortOrder: number;
}

// POST /api/chat/stream — SSE 流式 AI 对话
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    projectId: string;
    prompt: string;
    sessionId?: string;
    userMsgId?: string;
    model?: string;
    permissionMode?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, prompt, model } = body;
  // Sanitise the session ID sent by the client: the frontend can send a
  // "pending-<uuid>" optimistic placeholder when the user sends a second
  // message before session_init arrives. That ID never exists in the DB, so
  // passing it to the server causes a foreign-key constraint violation.
  // Treat any "pending-" value — or a missing value — as "no existing session".
  const sessionId =
    typeof body.sessionId === "string" && !body.sessionId.startsWith("pending-")
      ? body.sessionId
      : undefined;
  const permissionMode = isPermissionMode(body.permissionMode)
    ? body.permissionMode
    : "default";
  const userMsgId = body.userMsgId || uuidv4();

  if (!projectId || !prompt) {
    return NextResponse.json(
      { error: "projectId and prompt are required" },
      { status: 400 }
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let projectPath: string;
  let useSandbox = false;
  let sandboxBaseUrl = "";
  let sandboxCwd = "";

  if (project.workspaceId) {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, project.workspaceId), eq(workspaces.userId, session.user.id)))
      .limit(1);

    if (workspace) {
      // Always call getOrCreate — it returns the cached instance if already running,
      // and re-connects (or creates fresh) if the process was restarted and the
      // in-memory map is empty (e.g. dev hot-reload, multi-instance, etc.)
      await SandboxManager.getOrCreate(project.workspaceId);

      const sandboxInstance = SandboxManager.getRunningInstance(project.workspaceId);
      if (sandboxInstance) {
        useSandbox = true;
        sandboxBaseUrl = await SandboxManager.ensureServerRunning(project.workspaceId, sandboxInstance);
        // Defensive: the project's directory is normally created in the
        // background when the project is added (see POST /api/projects),
        // but that can still be in flight, or the sandbox may have been
        // recreated from a snapshot taken before the project existed.
        // mkdir -p is idempotent and cheap, so just always ensure it here
        // rather than trusting a spawn into a missing cwd (which fails with
        // a confusing "binary exists but failed to launch" error instead of
        // a clear ENOENT).
        await SandboxManager.ensureProjectDirectory(sandboxInstance, project.path);
        sandboxCwd = `/workspace/${project.path}`;
        projectPath = sandboxCwd;
      } else {
        // Sandbox failed to start — surface a clear error instead of silently falling back
        return NextResponse.json(
          { error: "Sandbox failed to start for this workspace. Check the workspace sandbox status." },
          { status: 503 }
        );
      }
    }
  }

  if (!useSandbox) {
    try {
      projectPath = await validateProjectDirectory(project.path);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid project path" },
        { status: 400 }
      );
    }
  } else {
    projectPath = sandboxCwd;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (eventType: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      const getSortBase = async (sid: string): Promise<number> => {
        const rows = await db
          .select({ sortOrder: chatMessages.sortOrder })
          .from(chatMessages)
          .where(eq(chatMessages.sessionId, sid))
          .orderBy(chatMessages.sortOrder);
        return rows.length > 0 ? rows[rows.length - 1].sortOrder + 1 : 0;
      };

      // Tracks the current session's permission key for cleanup in finally.
      // Only populated in the Direct branch; undefined in the Sandbox branch.
      let activeSessionPermissionKey: string | undefined;

      try {
        // ── Sandbox branch ──────────────────────────────────────────────────
        if (useSandbox) {
          const assistantMsgId = uuidv4();
          const isFirstMessage = !sessionId;
          const sortBase = sessionId ? await getSortBase(sessionId) : 0;
          let sortCounter = 0;
          let newSessionId = sessionId;

          const pendingMessages: PendingMessage[] = [
            {
              id: userMsgId,
              role: "user",
              blocks: [{ type: "text", text: prompt }],
              sortOrder: sortBase + sortCounter++,
            },
          ];

          // Wrap emit so permission_request events get the assistantMsgId injected
          const sandboxEmit = (eventType: string, data: Record<string, unknown>) => {
            if (
              eventType !== "permission_request" &&
              eventType !== "permission_resolved" &&
              eventType !== "done" &&
              eventType !== "error" &&
              eventType !== "session_init"
            ) {
              emit(eventType, { ...data, msgId: assistantMsgId });
            } else {
              emit(eventType, data);
            }
          };

          // Listen for session_init to capture sessionId
          const origEmit = sandboxEmit;
          const wrappedEmit = (eventType: string, data: Record<string, unknown>) => {
            if (eventType === "session_init" && data.sessionId) {
              const initSessionId = data.sessionId as string;
              newSessionId = initSessionId;
              if (isFirstMessage) {
                const now = new Date();
                db.insert(projectSessions)
                  .values({
                    sessionId: initSessionId,
                    projectId,
                    title: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
                    lastActiveAt: now,
                    createdAt: now,
                  })
                  .onConflictDoUpdate({ target: projectSessions.sessionId, set: { lastActiveAt: now } })
                  .catch(() => {/* ignore */});
              }
            }
            origEmit(eventType, data);
          };

          let sandboxResult: { sessionId: string | undefined; assistantBlocks: Block[] };
          try {
            sandboxResult = await sandboxStreamProxy(
              {
                sandboxBaseUrl,
                projectId,
                prompt,
                cwd: sandboxCwd,
                sessionId,
                model,
                permissionMode,
                userMsgId,
                assistantMsgId,
                workspaceId: project.workspaceId!,
              },
              wrappedEmit,
              req.signal
            );
          } catch (err) {
            // The sandbox may have been auto-stopped (Vercel returns 410 once
            // its timeout elapses). Drop the stale cached reference and retry
            // once against a freshly reconnected/recreated sandbox instead of
            // surfacing the error straight to the user.
            const message = err instanceof Error ? err.message : "";
            const isStaleSandbox = message.includes("Sandbox server error 410");
            if (!isStaleSandbox) throw err;

            SandboxManager.invalidate(project.workspaceId!);
            await SandboxManager.getOrCreate(project.workspaceId!);
            const freshInstance = SandboxManager.getRunningInstance(project.workspaceId!);
            if (!freshInstance) throw err;

            const freshBaseUrl = await SandboxManager.ensureServerRunning(project.workspaceId!, freshInstance);
            sandboxResult = await sandboxStreamProxy(
              {
                sandboxBaseUrl: freshBaseUrl,
                projectId,
                prompt,
                cwd: sandboxCwd,
                sessionId,
                model,
                permissionMode,
                userMsgId,
                assistantMsgId,
                workspaceId: project.workspaceId!,
              },
              wrappedEmit,
              req.signal
            );
          }

          const { sessionId: finalSessionId, assistantBlocks } = sandboxResult;

          // Persist messages
          const resolvedSessionId = finalSessionId ?? newSessionId;
          if (resolvedSessionId && pendingMessages.length > 0) {
            const now = new Date();
            // Include assistant message with blocks accumulated by the proxy
            pendingMessages.push({
              id: assistantMsgId,
              role: "assistant",
              blocks: assistantBlocks,
              sortOrder: sortBase + sortCounter++,
            });
            await db.insert(chatMessages).values(
              pendingMessages.map((m) => ({
                id: m.id,
                sessionId: resolvedSessionId,
                role: m.role,
                type: m.role === "user" ? "text" : "blocks",
                content: m.role === "user" ? (m.blocks[0] as { text: string }).text : "",
                toolCallJson: JSON.stringify(m.blocks),
                sortOrder: m.sortOrder,
                createdAt: now,
              }))
            );
            if (!isFirstMessage) {
              await db.update(projectSessions)
                .set({ lastActiveAt: now })
                .where(eq(projectSessions.sessionId, resolvedSessionId));
            }
          }
          return;
        }

        // ── Direct (local) branch ────────────────────────────────────────────
        const { query } = await import("@anthropic-ai/claude-agent-sdk");

        let newSessionId = sessionId;
        const isFirstMessage = !sessionId;
        let sortBase = sessionId ? await getSortBase(sessionId) : 0;
        let sortCounter = 0;

        const pendingMessages: PendingMessage[] = [];

        // 用户消息（单文本 block）
        pendingMessages.push({
          id: userMsgId,
          role: "user",
          blocks: [{ type: "text", text: prompt }],
          sortOrder: sortBase + sortCounter++,
        });

        // 当前 assistant turn 的消息 ID 和 blocks（流式累积）
        let assistantMsgId = uuidv4();
        let assistantBlocks: Block[] = [];

        // 工具计时：toolUseId → 开始时间戳
        const toolTimers = new Map<string, number>();

        // 思考开始时间
        let thinkingStartMs = 0;

        const getSessionPermissionKey = () =>
          `${session.user.id}:${projectId}:${newSessionId ?? sessionId ?? userMsgId}`;
        // Expose to the outer finally block for cleanup
        activeSessionPermissionKey = getSessionPermissionKey();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queryOptions: any = {
          cwd: projectPath,
          permissionMode,
          enableFileCheckpointing: true,
          includePartialMessages: true,
          // Spread process.env first so PATH and other inherited vars are preserved;
          // then overlay the custom Anthropic endpoint / key / model defaults.
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
            options: {
              toolUseID: string;
              suggestions?: import("@anthropic-ai/claude-agent-sdk").PermissionUpdate[];
              title?: string;
              displayName?: string;
              description?: string;
              blockedPath?: string;
              decisionReason?: string;
              signal: AbortSignal;
            }
          ) => {
            const requestId = uuidv4();
            const toolUseID = options.toolUseID;
            const sessionPermissionKey = getSessionPermissionKey();
            const allowedUpdates = getAllowedSessionPermissionUpdates(
              sessionPermissionKey,
              toolName,
              input
            );

            if (allowedUpdates?.length) {
              return toPermissionResult(
                {
                  behavior: "allow",
                  updatedInput: input,
                  updatedPermissions: allowedUpdates,
                },
                toolUseID,
                input
              );
            }

            emit("permission_request", {
              requestId,
              toolUseId: toolUseID,
              toolName,
              input,
              title: options.title,
              displayName: options.displayName,
              description: options.description,
              blockedPath: options.blockedPath,
              decisionReason: options.decisionReason,
            });

            const decision = await new Promise<
              | {
                  behavior: "allow";
                  updatedInput?: Record<string, unknown>;
                  updatedPermissions?: import("@anthropic-ai/claude-agent-sdk").PermissionUpdate[];
                }
              | { behavior: "deny"; message: string }
            >(
              (resolve) => {
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
                  toolName,
                  input,
                  toolUseID,
                  sessionPermissionKey,
                  suggestions: options.suggestions,
                });
              }
            );

            emit("permission_resolved", { requestId, behavior: decision.behavior });
            return toPermissionResult(decision, toolUseID, input);
          },
        };

        if (sessionId) {
          queryOptions.resume = sessionId;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const message of query({ prompt, options: queryOptions }) as any) {
          const msgType = (message as { type: string }).type;

          if (msgType === "system" && (message as { subtype?: string }).subtype === "init") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const initMsg = message as any;
            if (initMsg.session_id) {
              const initializedSessionId = initMsg.session_id as string;
              newSessionId = initializedSessionId;
              // 仅在真正新建会话时重置 sortBase；恢复已有会话时保留从数据库计算的值
              if (!sessionId) {
                sortBase = 0;
                const now = new Date();
                await db
                  .insert(projectSessions)
                  .values({
                    sessionId: initializedSessionId,
                    projectId,
                    title: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
                    lastActiveAt: now,
                    createdAt: now,
                  })
                  .onConflictDoUpdate({
                    target: projectSessions.sessionId,
                    set: { lastActiveAt: now },
                  });
              }
              emit("session_init", { sessionId: newSessionId, cwd: initMsg.cwd });
            }
          } else if (msgType === "stream_event") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const event = (message as any).event;
            if (!event) continue;

            if (event.type === "content_block_start") {
              const block = event.content_block;
              if (block?.type === "thinking") {
                thinkingStartMs = Date.now();
                // 追加 thinking block（空文本，delta 会填充）
                assistantBlocks.push({ type: "thinking", text: "" });
              } else if (block?.type === "text") {
                // 追加 text block
                assistantBlocks.push({ type: "text", text: "" });
              }
            } else if (event.type === "content_block_delta") {
              const delta = event.delta;
              if (!delta) continue;

              if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
                // 追加到最后一个 thinking block
                const last = assistantBlocks[assistantBlocks.length - 1];
                if (last?.type === "thinking") {
                  last.text += delta.thinking;
                  emit("thinking_delta", { msgId: assistantMsgId, delta: delta.thinking });
                }
              } else if (delta.type === "text_delta" && typeof delta.text === "string") {
                // 追加到最后一个 text block
                const last = assistantBlocks[assistantBlocks.length - 1];
                if (last?.type === "text") {
                  last.text += delta.text;
                  emit("text_delta", { msgId: assistantMsgId, delta: delta.text });
                }
              }
            } else if (event.type === "content_block_stop") {
              // 当一个 thinking block 关闭时，记录时长
              const last = assistantBlocks[assistantBlocks.length - 1];
              if (last?.type === "thinking" && thinkingStartMs > 0) {
                const durationSeconds = (Date.now() - thinkingStartMs) / 1000;
                last.durationSeconds = durationSeconds;
                emit("thinking_done", { msgId: assistantMsgId, durationSeconds });
                thinkingStartMs = 0;
              }
            }
          } else if (msgType === "assistant") {
            // 处理完整 assistant 消息（tool_use blocks 只在这里出现）
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const content = (message as any).message?.content || [];

            for (const block of content) {
              if (block.type === "tool_use") {
                const toolUseId: string = block.id;
                toolTimers.set(toolUseId, Date.now());
                // 追加 tool_use block
                const toolBlock: ToolUseBlock = {
                  type: "tool_use",
                  toolUseId,
                  toolName: block.name,
                  input: block.input || {},
                  status: "running",
                };
                assistantBlocks.push(toolBlock);
                emit("tool_start", {
                  msgId: assistantMsgId,
                  toolUseId,
                  toolName: block.name,
                  input: block.input || {},
                });
              }
            }
          } else if (msgType === "user") {
            // tool_result 消息 — 回填工具结果
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const userMsg = message as any;
            const msgContent = userMsg.message?.content || [];

            for (const block of msgContent) {
              if (block.type === "tool_result") {
                const toolUseId: string = block.tool_use_id;
                const durationMs = Date.now() - (toolTimers.get(toolUseId) ?? Date.now());
                toolTimers.delete(toolUseId);

                const output =
                  typeof block.content === "string"
                    ? block.content
                    : Array.isArray(block.content)
                    ? block.content
                        .filter((c: { type: string }) => c.type === "text")
                        .map((c: { text: string }) => c.text)
                        .join("\n")
                    : "";

                const isError = block.is_error ?? false;

                // 更新 blocks 数组中对应的 tool_use block
                const toolBlock = assistantBlocks.find(
                  (b): b is ToolUseBlock => b.type === "tool_use" && b.toolUseId === toolUseId
                );
                if (toolBlock) {
                  toolBlock.output = output;
                  toolBlock.isError = isError;
                  toolBlock.status = isError ? "error" : "done";
                  toolBlock.durationMs = durationMs;
                }

                emit("tool_end", {
                  msgId: assistantMsgId,
                  toolUseId,
                  output,
                  isError,
                  durationMs,
                });
              }
            }
          } else if (msgType === "result") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resultMsg = message as any;
            const finalSessionId = resultMsg.session_id || newSessionId;
            const now = new Date();

            // 当前 assistant turn 最终推入待持久化队列
            if (assistantBlocks.length > 0) {
              pendingMessages.push({
                id: assistantMsgId,
                role: "assistant",
                blocks: [...assistantBlocks],
                sortOrder: sortBase + sortCounter++,
              });
              // 重置状态，为下一个可能的 turn 做准备
              assistantMsgId = uuidv4();
              assistantBlocks = [];
            }

            if (finalSessionId && isFirstMessage) {
              const sessionTitle = prompt.slice(0, 50) + (prompt.length > 50 ? "..." : "");
              await db
                .insert(projectSessions)
                .values({
                  sessionId: finalSessionId,
                  projectId,
                  title: sessionTitle,
                  lastActiveAt: now,
                  createdAt: now,
                })
                .onConflictDoUpdate({
                  target: projectSessions.sessionId,
                  set: { lastActiveAt: now },
                });
            } else if (finalSessionId && !isFirstMessage) {
              await db
                .update(projectSessions)
                .set({ lastActiveAt: now })
                .where(eq(projectSessions.sessionId, finalSessionId));
            }

            // 批量持久化所有消息（blocks 以 JSON 存储）
            if (finalSessionId && pendingMessages.length > 0) {
              await db.insert(chatMessages).values(
                pendingMessages.map((m) => ({
                  id: m.id,
                  sessionId: finalSessionId,
                  role: m.role,
                  type: m.role === "user" ? "text" : "blocks",
                  content: m.role === "user"
                    ? (m.blocks[0] as { text: string }).text
                    : "",
                  toolCallJson: JSON.stringify(m.blocks),
                  sortOrder: m.sortOrder,
                  createdAt: now,
                }))
              );
            }

            emit("done", {
              sessionId: finalSessionId,
              costUsd: resultMsg.cost_usd,
              durationMs: resultMsg.duration_ms,
            });
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        emit("error", { message: errMsg });
      } finally {
        // Clean up per-session permission rules so the Map doesn't grow indefinitely.
        // The TTL in pending-permissions.ts is a safety net; this is the primary cleanup.
        clearSessionPermissionUpdates(activeSessionPermissionKey);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// 保留 GET 兼容旧客户端（临时过渡，可后续移除）
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const projectId = searchParams.get("projectId") || "";
  const prompt = searchParams.get("prompt") || "";
  const sessionId = searchParams.get("sessionId") || undefined;
  const userMsgId = searchParams.get("userMsgId") || undefined;
  const permissionMode = isPermissionMode(searchParams.get("permissionMode"))
    ? searchParams.get("permissionMode")
    : undefined;

  const syntheticReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ projectId, prompt, sessionId, userMsgId, permissionMode }),
  });

  return POST(new NextRequest(syntheticReq));
}

// ToolUseBlock 类型（本文件内部使用）
interface ToolUseBlock {
  type: "tool_use";
  toolUseId: string;
  toolName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  output?: string;
  isError?: boolean;
  status: "running" | "done" | "error";
  durationMs?: number;
}
