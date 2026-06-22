import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// PUT /api/projects/[id] — 修改项目
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, defaultModel } = body;

  const [updated] = await db
    .update(projects)
    .set({
      ...(name && { name }),
      ...(defaultModel && { defaultModel }),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Project not found or unauthorized" },
      { status: 404 }
    );
  }

  return NextResponse.json(updated);
}

// DELETE /api/projects/[id] — 删除项目
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [deleted] = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .returning();

  if (!deleted) {
    return NextResponse.json(
      { error: "Project not found or unauthorized" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
