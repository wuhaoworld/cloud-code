import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces, projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// lazy import to avoid issues if @vercel/sandbox is not installed
async function getSandboxClass() {
  try {
    const mod = await import("@vercel/sandbox");
    return mod.Sandbox as typeof import("@vercel/sandbox").Sandbox;
  } catch {
    return null;
  }
}

function getCredentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  if (VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID) {
    return { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID };
  }
  return {};
}

// DELETE /api/workspaces/:id — 删除 workspace 及所有关联数据
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify workspace belongs to current user
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id)))
    .limit(1);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // ── 1. Cleanup Vercel Sandbox (best-effort) ──────────────────────────────
  // IMPORTANT: sandbox name is always equal to workspace.id (see sandbox-manager.ts
  // getOrCreate: `name: workspaceId`). Do NOT rely on workspace.sandboxId here —
  // SandboxManager.stop() sets it to null before this route is called, causing
  // sandbox.delete() to be skipped and leaving snapshots permanently billable.
  const Sandbox = await getSandboxClass();
  if (Sandbox) {
    try {
      const credentials = getCredentials();
      const sandbox = await Sandbox.get({ name: id, ...credentials });
      // sandbox.delete() permanently removes the sandbox and all its snapshots
      await sandbox.delete();
    } catch (err) {
      // If sandbox is already gone (404 or never existed), that's fine — continue
      console.warn(`[workspace delete] sandbox cleanup failed (continuing):`, err);
    }
  }

  // Also invalidate any in-process cached sandbox state
  try {
    const { SandboxManager } = await import("@/lib/sandbox-manager");
    SandboxManager.invalidate(id);
  } catch {
    // ignore
  }

  // ── 2. Delete workspace from DB ─────────────────────────────────────────
  // Delete projects tied to this workspace FIRST (before the workspace is
  // deleted), because the FK uses onDelete: "set null" — once the workspace
  // row is gone, workspaceId becomes null and we can no longer find them.
  // Cascading on project rows will also delete their sessions and messages.
  await db
    .delete(projects)
    .where(and(eq(projects.workspaceId, id), eq(projects.userId, session.user.id)));

  // Now delete the workspace itself
  await db.delete(workspaces).where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id)));

  return NextResponse.json({ success: true });
}
