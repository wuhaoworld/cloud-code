import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects, projectSessions, chatMessages } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// PATCH /api/projects/[id]/sessions/[sessionId] — 重命名或置顶会话
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId, sessionId } = await params;

  // 验证项目属于当前用户
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.userId, session.user.id))
    )
    .limit(1);

  if (!project) {
    return NextResponse.json(
      { error: "Project not found or unauthorized" },
      { status: 404 }
    );
  }

  // 验证会话属于该项目
  const [existing] = await db
    .select()
    .from(projectSessions)
    .where(
      and(
        eq(projectSessions.sessionId, sessionId),
        eq(projectSessions.projectId, projectId)
      )
    )
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  // 重命名
  if (typeof body.title === "string") {
    updates.title = body.title.trim();
  }

  // 置顶/取消置顶
  if (typeof body.pinned === "boolean") {
    updates.pinnedAt = body.pinned ? new Date() : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  await db
    .update(projectSessions)
    .set(updates)
    .where(eq(projectSessions.sessionId, sessionId));

  return NextResponse.json({ success: true });
}

// DELETE /api/projects/[id]/sessions/[sessionId] — 删除会话
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId, sessionId } = await params;

  // 验证项目属于当前用户
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.userId, session.user.id))
    )
    .limit(1);

  if (!project) {
    return NextResponse.json(
      { error: "Project not found or unauthorized" },
      { status: 404 }
    );
  }

  // 验证会话属于该项目
  const [existing] = await db
    .select()
    .from(projectSessions)
    .where(
      and(
        eq(projectSessions.sessionId, sessionId),
        eq(projectSessions.projectId, projectId)
      )
    )
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 删除会话（chatMessages 有外键级联删除）
  await db
    .delete(projectSessions)
    .where(eq(projectSessions.sessionId, sessionId));

  return NextResponse.json({ success: true });
}
