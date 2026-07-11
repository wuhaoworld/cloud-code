import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SandboxManager } from "@/lib/sandbox-manager";

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

  const activeWorkspaces = userWorkspaces.filter((ws) => ws.sandboxStatus !== "idle");
  if (activeWorkspaces.length > 0) {
    await Promise.all(
      activeWorkspaces.map((ws) =>
        SandboxManager.syncRemoteStatus(ws.id).catch((err) => {
          console.error(`Failed to sync remote status for workspace ${ws.id}:`, err);
        })
      )
    );

    const updatedWorkspaces = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, session.user.id))
      .orderBy(workspaces.createdAt);

    return NextResponse.json(updatedWorkspaces);
  }

  return NextResponse.json(userWorkspaces);
}

const RESERVED_PATHS = new Set([
  "login",
  "admin",
  "signout",
  "signin",
  "signup",
  "sign-in",
  "sign-up",
  "api",
  "chat",
  "plugins",
  "settings",
  "forgot-password",
  "reset-password",
  "w",
  "favicon.ico",
  "logo.png"
]);

// POST /api/workspaces — 创建新 workspace
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, id } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "名称是必填项" }, { status: 400 });
  }

  if (!id?.trim()) {
    return NextResponse.json({ error: "Workspace ID 是必填项" }, { status: 400 });
  }

  const cleanId = id.trim();

  // 校验系统保留路径
  if (RESERVED_PATHS.has(cleanId.toLowerCase())) {
    return NextResponse.json(
      { error: "该 ID 是系统保留路径，无法使用" },
      { status: 400 }
    );
  }

  // 校验 ID 格式：只能包含字母、数字、连字符和下划线
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
    return NextResponse.json(
      { error: "Workspace ID 只能包含字母、数字、连字符和下划线" },
      { status: 400 }
    );
  }

  // 校验 ID 唯一性
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, cleanId))
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { error: "该 Workspace ID 已被占用，请尝试其他 ID" },
      { status: 400 }
    );
  }

  const now = new Date();
  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: cleanId,
      name: name.trim(),
      userId: session.user.id,
      sandboxId: cleanId,
      sandboxStatus: "starting",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Asynchronously trigger sandbox creation and startup in the background
  SandboxManager.getOrCreate(cleanId).catch((err) => {
    console.error(`Failed to automatically start sandbox for workspace ${cleanId}:`, err);
  });

  return NextResponse.json(workspace, { status: 201 });
}
