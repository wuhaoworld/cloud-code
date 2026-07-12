import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces, projects, projectSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { AppSidebar } from "@/components/sidebar/sidebar";
import { WorkspaceSync } from "./workspace-sync";
import type { Workspace, Project, ProjectSession } from "@/store/app-store";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const { workspace: workspaceId } = await params;

  // 并行预取：用户所有 workspaces + 当前 workspace 下的 projects
  const [userWorkspaces, workspaceProjects] = await Promise.all([
    db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, session.user.id))
      .orderBy(workspaces.createdAt),
    db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.userId, session.user.id),
          eq(projects.workspaceId, workspaceId)
        )
      )
      .orderBy(projects.updatedAt),
  ]);

  // 预取第一个项目的 sessions（默认展开第一个项目）
  const initialSessions: Record<string, ProjectSession[]> = {};
  if (workspaceProjects.length > 0) {
    const firstProjectId = workspaceProjects[workspaceProjects.length - 1].id; // updatedAt 降序，最后一个是最新
    const sessions = await db
      .select()
      .from(projectSessions)
      .where(eq(projectSessions.projectId, firstProjectId))
      .orderBy(projectSessions.lastActiveAt);
    initialSessions[firstProjectId] = sessions.reverse().map((s) => ({
      ...s,
      pinnedAt: s.pinnedAt ? s.pinnedAt.getTime() : null,
      lastActiveAt: s.lastActiveAt instanceof Date ? s.lastActiveAt.getTime() : s.lastActiveAt,
      createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : s.createdAt,
    })) as ProjectSession[];
  }

  // 将 DB Date 字段转换为 timestamp number（Store 类型要求 number）
  function toTimestamp(d: Date | number | null | undefined): number {
    if (!d) return 0;
    return d instanceof Date ? d.getTime() : d;
  }

  const serializedWorkspaces: Workspace[] = userWorkspaces.map((w) => ({
    ...w,
    createdAt: toTimestamp(w.createdAt),
    updatedAt: toTimestamp(w.updatedAt),
  }));

  const serializedProjects: Project[] = [...workspaceProjects].reverse().map((p) => ({
    ...p,
    createdAt: toTimestamp(p.createdAt),
    updatedAt: toTimestamp(p.updatedAt),
  }));

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 将服务端预取数据注入客户端 store */}
      <WorkspaceSync
        workspaceId={workspaceId}
        initialWorkspaces={serializedWorkspaces}
        initialProjects={serializedProjects}
        initialSessions={initialSessions}
      />

      {/* 左侧侧边栏 */}
      <AppSidebar
        initialProjects={serializedProjects}
        initialSessions={initialSessions}
      />

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
