import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SandboxManager } from "@/lib/sandbox-manager";

// GET /api/workspaces/:id/sandbox — 获取 sandbox 状态
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [workspace] = await db
    .select({
      id: workspaces.id,
      sandboxId: workspaces.sandboxId,
      sandboxSnapshotId: workspaces.sandboxSnapshotId,
      sandboxStatus: workspaces.sandboxStatus,
    })
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id)))
    .limit(1);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json(workspace);
}

// POST /api/workspaces/:id/sandbox — 启动或停止 sandbox
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action;

  if (action !== "start" && action !== "stop" && action !== "checkpoint") {
    return NextResponse.json(
      { error: "action must be 'start', 'stop', or 'checkpoint'" },
      { status: 400 }
    );
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id)))
    .limit(1);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    if (action === "start") {
      if (workspace.sandboxStatus === "running") {
        return NextResponse.json({ status: "already_running", sandboxId: workspace.sandboxId });
      }
      await SandboxManager.getOrCreate(id);
      const [updated] = await db
        .select({ sandboxId: workspaces.sandboxId, sandboxStatus: workspaces.sandboxStatus })
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .limit(1);
      return NextResponse.json({ status: "started", ...updated });
    }

    if (action === "stop") {
      await SandboxManager.stop(id);
      return NextResponse.json({ status: "stopped" });
    }

    if (action === "checkpoint") {
      await SandboxManager.checkpoint(id);
      const [updated] = await db
        .select({ sandboxSnapshotId: workspaces.sandboxSnapshotId })
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .limit(1);
      return NextResponse.json({ status: "checkpointed", ...updated });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sandbox operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
