import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { validateProjectDirectory } from "@/lib/project-path";
import { SandboxManager } from "@/lib/sandbox-manager";

export type ProjectFileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: ProjectFileNode[];
};

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "out", "build", ".cache",
  ".turbo", ".pnpm", "coverage", "__pycache__", ".venv", "venv",
]);
const MAX_DEPTH = 6;
const MAX_ENTRIES = 1_000;

// GET /api/projects/[id]/files?q=<filter>&tree=1
// 默认返回 chat-input 使用的扁平文件列表；tree=1 返回文件侧栏使用的层级结构。
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const q = req.nextUrl.searchParams.get("q")?.toLowerCase() ?? "";
  const includeTree = req.nextUrl.searchParams.get("tree") === "1";
  const emptyResult = () => (includeTree ? { tree: [] } : { files: [] });

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (project.workspaceId) {
    try {
      const sandbox = await SandboxManager.getOrCreate(project.workspaceId);
      const { baseUrl, token } = await SandboxManager.ensureServerRunning(
        project.workspaceId,
        sandbox,
      );
      await SandboxManager.ensureProjectDirectory(sandbox, project.path);

      const response = await fetch(`${baseUrl}/files`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ projectPath: project.path, q, tree: includeTree }),
      });
      if (!response.ok) throw new Error("Sandbox file listing failed");

      const data = await response.json() as {
        files?: string[];
        tree?: ProjectFileNode[];
      };
      return NextResponse.json(includeTree ? { tree: data.tree ?? [] } : { files: data.files ?? [] });
    } catch {
      return NextResponse.json(
        { error: "Unable to load files from the project sandbox" },
        { status: 503 },
      );
    }
  }

  let rootPath: string;
  try {
    rootPath = await validateProjectDirectory(project.path);
  } catch {
    return NextResponse.json(emptyResult());
  }

  const files: string[] = [];
  const tree: ProjectFileNode[] = [];

  function walk(
    directory: string,
    relativePath: string,
    depth: number,
    nodes: ProjectFileNode[],
  ) {
    if (depth > MAX_DEPTH || files.length >= MAX_ENTRIES) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      const directoryOrder = Number(b.isDirectory()) - Number(a.isDirectory());
      return directoryOrder || a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const children: ProjectFileNode[] = [];
        nodes.push({ name: entry.name, path: entryPath, type: "directory", children });
        files.push(`${entryPath}/`);
        walk(path.join(directory, entry.name), entryPath, depth + 1, children);
      } else {
        nodes.push({ name: entry.name, path: entryPath, type: "file" });
        files.push(entryPath);
      }

      if (files.length >= MAX_ENTRIES) break;
    }
  }

  try {
    walk(rootPath, "", 0, tree);
  } catch {
    return NextResponse.json(emptyResult());
  }

  if (includeTree) {
    return NextResponse.json({ tree });
  }

  const filtered = q
    ? files.filter((file) => file.toLowerCase().includes(q)).slice(0, 20)
    : files.slice(0, 20);

  return NextResponse.json({ files: filtered });
}
