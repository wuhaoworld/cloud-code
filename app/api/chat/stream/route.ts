import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects, projectSessions, chatMessages, workspaces } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { Block } from "@/store/types";
import { isPermissionMode } from "@/lib/permission-mode";
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
    : "bypassPermissions";
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

  // Verify that the session being resumed belongs to this project.
  // Without this check, an attacker can supply a sessionId from another
  // project (or another user) to cross-contaminate AI context.
  if (sessionId) {
    const [sessionRow] = await db
      .select({ sessionId: projectSessions.sessionId })
      .from(projectSessions)
      .where(
        and(
          eq(projectSessions.sessionId, sessionId),
          eq(projectSessions.projectId, projectId)
        )
      )
      .limit(1);
    if (!sessionRow) {
      return NextResponse.json(
        { error: "Session not found or does not belong to this project" },
        { status: 404 }
      );
    }
  }

  if (!project.workspaceId) {
    return NextResponse.json(
      { error: "This project requires a Sandbox workspace" },
      { status: 503 }
    );
  }

  let sandboxBaseUrl = "";
  let sandboxToken = "";
  let sandboxCwd = "";

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, project.workspaceId), eq(workspaces.userId, session.user.id)))
    .limit(1);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

      // Always call getOrCreate — it returns the cached instance if already running,
      // and re-connects (or creates fresh) if the process was restarted and the
      // in-memory map is empty (e.g. dev hot-reload, multi-instance, etc.)
      await SandboxManager.getOrCreate(project.workspaceId);

      const sandboxInstance = SandboxManager.getRunningInstance(project.workspaceId);
      if (sandboxInstance) {
        ({ baseUrl: sandboxBaseUrl, token: sandboxToken } = await SandboxManager.ensureServerRunning(
          project.workspaceId,
          sandboxInstance
        ));
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
      } else {
        // Sandbox failed to start — surface a clear error instead of silently falling back
        return NextResponse.json(
          { error: "Sandbox failed to start for this workspace. Check the workspace sandbox status." },
          { status: 503 }
        );
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

      try {
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
                sandboxToken,
                projectId,
                prompt,
                cwd: sandboxCwd,
                sessionId,
                model,
                permissionMode,
                userMsgId,
                assistantMsgId,
                workspaceId: project.workspaceId!,
                userId: session.user.id,
              },
              wrappedEmit,
              req.signal
            );
          } catch (err) {
            // The sandbox may have been auto-stopped (410) or the in-sandbox
            // HTTP server restarted with a new token (401). Drop the stale
            // cached reference and retry once against a freshly reconnected/
            // recreated sandbox instead of surfacing the error to the user.
            const message = err instanceof Error ? err.message : "";
            const isStaleSandbox =
              message.includes("Sandbox server error 410") ||
              message.includes("Sandbox server error 401");
            if (!isStaleSandbox) throw err;

            SandboxManager.invalidate(project.workspaceId!);
            await SandboxManager.getOrCreate(project.workspaceId!);
            const freshInstance = SandboxManager.getRunningInstance(project.workspaceId!);
            if (!freshInstance) throw err;

            const freshBaseUrl = await SandboxManager.ensureServerRunning(project.workspaceId!, freshInstance);
            sandboxResult = await sandboxStreamProxy(
              {
                sandboxBaseUrl: freshBaseUrl.baseUrl,
                sandboxToken: freshBaseUrl.token,
                projectId,
                prompt,
                cwd: sandboxCwd,
                sessionId,
                model,
                permissionMode,
                userMsgId,
                assistantMsgId,
                workspaceId: project.workspaceId!,
                userId: session.user.id,
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


      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        emit("error", { message: errMsg });
      } finally {
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
