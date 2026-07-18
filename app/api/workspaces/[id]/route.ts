import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces, projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SandboxManager } from "@/lib/sandbox-manager";

// DELETE /api/workspaces/:id — delete an E2B sandbox and its workspace data.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [workspace] = await db.select().from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id))).limit(1);
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  try {
    await SandboxManager.destroy(id);
  } catch (error) {
    // The database must still be removable if the remote E2B resource is gone.
    console.warn(`[workspace delete] E2B cleanup failed (continuing):`, error);
  }

  await db.delete(projects).where(
    and(eq(projects.workspaceId, id), eq(projects.userId, session.user.id))
  );
  await db.delete(workspaces).where(
    and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id))
  );

  return NextResponse.json({ success: true });
}
