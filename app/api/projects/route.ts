import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects, workspaces } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { validateProjectDirectory } from "@/lib/project-path";
import { SandboxManager } from "@/lib/sandbox-manager";

// GET /api/projects — 获取当前用户所有项目
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(projects.updatedAt);

  return NextResponse.json(userProjects.reverse());
}

// POST /api/projects — 创建新项目
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, path, defaultModel, workspaceId } = body as {
    name: string;
    path: string;
    defaultModel?: string;
    workspaceId?: string;
  };

  if (!name || !path) {
    return NextResponse.json(
      { error: "name and path are required" },
      { status: 400 }
    );
  }

  // Sandbox mode: workspaceId provided — validate workspace ownership and path format
  if (workspaceId) {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id)))
      .limit(1);

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Sandbox path must be a simple relative name (no slashes, no traversal)
    if (!/^[a-zA-Z0-9_-]+$/.test(path.trim())) {
      return NextResponse.json(
        { error: "Sandbox directory name must contain only letters, numbers, hyphens and underscores" },
        { status: 400 }
      );
    }

    const now = new Date();
    const [newProject] = await db
      .insert(projects)
      .values({
        id: uuidv4(),
        name,
        path: path.trim(),
        defaultModel: defaultModel || "claude-opus-4-5",
        workspaceId,
        userId: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Auto-start the sandbox in the background if it's idle
    if (workspace.sandboxStatus === "idle") {
      SandboxManager.getOrCreate(workspaceId).catch(() => {/* sandbox start errors surface via the status API */});
    }

    return NextResponse.json(newProject, { status: 201 });
  }

  // Local mode: validate the directory path on the server filesystem
  let normalizedPath: string;
  try {
    normalizedPath = await validateProjectDirectory(path);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid project path" },
      { status: 400 }
    );
  }

  const now = new Date();
  const [newProject] = await db
    .insert(projects)
    .values({
      id: uuidv4(),
      name,
      path: normalizedPath,
      defaultModel: defaultModel || "claude-opus-4-5",
      workspaceId: null,
      userId: session.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(newProject, { status: 201 });
}
