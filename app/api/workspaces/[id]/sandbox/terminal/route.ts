import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { SandboxManager } from "@/lib/sandbox-manager";
import { getSandboxTerminalContext } from "@/lib/sandbox-terminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COMMAND_LENGTH = 10_000;

// POST /api/workspaces/:id/sandbox/terminal — proxy one command to the Sandbox VM as SSE.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: workspaceId } = await params;
  const body = await req.json().catch(() => null) as {
    projectId?: unknown;
    command?: unknown;
  } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const command = typeof body?.command === "string" ? body.command : "";

  if (!projectId || !command.trim() || command.length > MAX_COMMAND_LENGTH || command.includes("\0")) {
    return NextResponse.json({ error: "A valid command up to 10,000 characters is required" }, { status: 400 });
  }

  const context = await getSandboxTerminalContext(workspaceId, projectId, session.user.id);
  if (!context) {
    return NextResponse.json({ error: "Workspace or project not found" }, { status: 404 });
  }

  try {
    const sandbox = await SandboxManager.getOrCreate(workspaceId);
    const { baseUrl, token } = await SandboxManager.ensureServerRunning(workspaceId, sandbox);
    await SandboxManager.ensureProjectDirectory(sandbox, context.project.path);

    const response = await fetch(`${baseUrl}/terminal/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ projectPath: context.project.path, command }),
      signal: req.signal,
    });

    if (!response.ok || !response.body) {
      const message = await response.text().catch(() => "Sandbox command request failed");
      return NextResponse.json({ error: message || "Sandbox command request failed" }, {
        status: response.status === 400 || response.status === 409 ? response.status : 502,
      });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to execute command in Sandbox";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
