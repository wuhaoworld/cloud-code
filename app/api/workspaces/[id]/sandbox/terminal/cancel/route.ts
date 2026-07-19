import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getSandboxTerminalContext } from "@/lib/sandbox-terminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/workspaces/:id/sandbox/terminal/cancel — stop a running terminal command.
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
    executionId?: unknown;
  } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const executionId = typeof body?.executionId === "string" ? body.executionId : "";

  if (!projectId || !executionId) {
    return NextResponse.json({ error: "projectId and executionId are required" }, { status: 400 });
  }

  const context = await getSandboxTerminalContext(workspaceId, projectId, session.user.id);
  if (!context) {
    return NextResponse.json({ error: "Workspace or project not found" }, { status: 404 });
  }

  if (!context.workspace.sandboxUrl || !context.workspace.sandboxToken) {
    return NextResponse.json({ error: "Sandbox is not running" }, { status: 409 });
  }

  try {
    const response = await fetch(`${context.workspace.sandboxUrl}/terminal/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${context.workspace.sandboxToken}`,
      },
      body: JSON.stringify({ executionId }),
      signal: req.signal,
    });

    if (!response.ok) {
      const message = await response.text().catch(() => "Unable to cancel Sandbox command");
      return NextResponse.json({ error: message || "Unable to cancel Sandbox command" }, {
        status: response.status === 404 ? 404 : 502,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to cancel Sandbox command";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
