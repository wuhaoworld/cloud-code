import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// GET /api/workspaces — 获取当前用户所有 workspace
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userWorkspaces = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, session.user.id))
    .orderBy(workspaces.createdAt);

  return NextResponse.json(userWorkspaces);
}

// POST /api/workspaces — 创建新 workspace
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const now = new Date();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: uuidv4(),
      name: name.trim(),
      userId: session.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(workspace, { status: 201 });
}
