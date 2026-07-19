import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, workspaces } from "@/db/schema";

export type SandboxTerminalContext = {
  project: {
    id: string;
    path: string;
    workspaceId: string | null;
  };
  workspace: {
    id: string;
    sandboxStatus: "idle" | "starting" | "running" | "snapshotting";
    sandboxToken: string | null;
    sandboxUrl: string | null;
  };
};

export async function getSandboxTerminalContext(
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<SandboxTerminalContext | null> {
  const [workspace] = await db
    .select({
      id: workspaces.id,
      sandboxStatus: workspaces.sandboxStatus,
      sandboxToken: workspaces.sandboxToken,
      sandboxUrl: workspaces.sandboxUrl,
    })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);

  if (!workspace) return null;

  const [project] = await db
    .select({ id: projects.id, path: projects.path, workspaceId: projects.workspaceId })
    .from(projects)
    .where(and(
      eq(projects.id, projectId),
      eq(projects.userId, userId),
      eq(projects.workspaceId, workspaceId),
    ))
    .limit(1);

  return project ? { project, workspace } : null;
}
