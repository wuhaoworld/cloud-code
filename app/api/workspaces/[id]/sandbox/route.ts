import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SandboxManager } from "@/lib/sandbox-manager";

// GET /api/workspaces/:id/sandbox — get the authoritative E2B sandbox status.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [workspace] = await db.select({ userId: workspaces.userId })
    .from(workspaces).where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id))).limit(1);
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  await SandboxManager.syncRemoteStatus(id).catch((error) => {
    console.error(`Failed to sync E2B sandbox status for workspace ${id}:`, error);
  });

  const [updated] = await db.select({
    id: workspaces.id,
    sandboxId: workspaces.sandboxId,
    sandboxStatus: workspaces.sandboxStatus,
  }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return NextResponse.json(updated);
}

// POST /api/workspaces/:id/sandbox — start/resume or pause an E2B sandbox.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { action } = await req.json().catch(() => ({})) as { action?: string };
  if (action !== "start" && action !== "stop") {
    return NextResponse.json({ error: "action must be 'start' or 'stop'" }, { status: 400 });
  }

  const [workspace] = await db.select().from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id))).limit(1);
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  try {
    if (action === "start") {
      if (workspace.sandboxStatus === "running") {
        return NextResponse.json({ status: "already_running", sandboxId: workspace.sandboxId });
      }
      await SandboxManager.getOrCreate(id);
      const [updated] = await db.select({
        sandboxId: workspaces.sandboxId,
        sandboxStatus: workspaces.sandboxStatus,
      }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
      return NextResponse.json({ status: "started", ...updated });
    }

    await SandboxManager.pause(id);
    return NextResponse.json({ status: "paused" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "E2B sandbox operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
