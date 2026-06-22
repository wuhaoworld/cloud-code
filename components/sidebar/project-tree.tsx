"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  FolderOpen,
  Folder,
  Plus,
  MoreHorizontal,
  Trash2,
  Pencil,
  SquarePen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/store/app-store";
import type { Project, ProjectSession } from "@/store/app-store";
import { SessionActionsMenu } from "@/components/session-actions-menu";
import { toast } from "sonner";

interface ProjectTreeProps {
  onNewSession?: (projectId: string) => void;
}

export function ProjectTree({ onNewSession }: ProjectTreeProps) {
  const router = useRouter();
  const {
    projects,
    sessions,
    expandedProjects,
    currentProjectId,
    currentSessionId,
    setProjects,
    setSessions,
    removeProject,
    toggleProjectExpanded,
    setExpandedProjects,
    setCurrentProject,
    setCurrentSession,
    clearMessages,
  } = useAppStore();

  // 加载项目的会话列表
  const loadSessions = useCallback(
    async (projectId: string) => {
      try {
        const res = await fetch(`/api/projects/${projectId}/sessions`);
        if (!res.ok) return;
        const data = await res.json();
        setSessions(projectId, data);
      } catch {
        /* ignore */
      }
    },
    [setSessions]
  );

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data);

      if (Array.isArray(data) && data.length > 0) {
        let expandedIds: string[] = [];
        let hasRecord = false;
        if (typeof window !== "undefined") {
          const stored = localStorage.getItem("expanded-projects");
          if (stored !== null) {
            try {
              expandedIds = JSON.parse(stored);
              hasRecord = true;
            } catch {
              /* ignore */
            }
          }
        }

        if (!hasRecord) {
          // 如果没有记录，默认只展开第一个项目
          expandedIds = [data[0].id];
        }

        // 仅保留属于当前项目的有效 ID
        const validExpandedIds = expandedIds.filter((id) =>
          data.some((p: Project) => p.id === id)
        );

        if (!hasRecord || validExpandedIds.length !== expandedIds.length) {
          if (typeof window !== "undefined") {
            localStorage.setItem("expanded-projects", JSON.stringify(validExpandedIds));
          }
        }

        setExpandedProjects(validExpandedIds);
        // 并行加载已被展开项目的会话列表
        await Promise.all(
          data
            .filter((p: Project) => validExpandedIds.includes(p.id))
            .map((p: Project) => loadSessions(p.id))
        );
      }
    } catch {
      /* ignore */
    }
  }, [setProjects, setExpandedProjects, loadSessions]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleToggleProject = async (project: Project) => {
    toggleProjectExpanded(project.id);
    // 展开时加载会话
    if (!expandedProjects.has(project.id)) {
      await loadSessions(project.id);
    }
  };

  const handleSelectSession = (project: Project, session: ProjectSession) => {
    setCurrentProject(project.id);
    setCurrentSession(session.sessionId);
    clearMessages();
    router.push(`/chat/${project.id}/${session.sessionId}`);
  };

  const handleNewSession = (project: Project) => {
    setCurrentProject(project.id);
    setCurrentSession(null);
    clearMessages();
    router.push(`/chat/${project.id}`);
    onNewSession?.(project.id);
  };

  const handleDeleteProject = async (projectId: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("删除失败");
        return;
      }
      removeProject(projectId);
      toast.success(`项目 "${name}" 已删除`);
      if (currentProjectId === projectId) {
        router.push("/chat");
      }
    } catch {
      toast.error("网络错误");
    }
  };

  if (projects.length === 0) {
    return (
      <div className="px-4 py-4 text-center">
        <p className="text-xs text-muted-foreground">暂无项目</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          点击上方&quot;+&quot;新建项目
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 py-1 px-1">
      {projects.map((project) => {
        const isExpanded = expandedProjects.has(project.id);
        const isActive = currentProjectId === project.id;
        const projectSessions = sessions[project.id] || [];

        return (
          <div key={project.id}>
            {/* 项目行 — 点击整行展开/收起 */}
            <div
              className={cn(
                "group flex items-center gap-1 px-3 py-1.5 rounded-md",
                "hover:bg-[#EBEBED] transition-colors",
                isActive && !currentSessionId && "bg-[#EBEBED]"
              )}
              onClick={() => handleToggleProject(project)}
            >
              {/* 文件夹图标 + 名称 + 展开箭头 */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {isExpanded ? (
                  <FolderOpen className="size-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <Folder className="size-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm truncate leading-none">
                  {project.name}
                </span>
                <ChevronRight
                  className={cn(
                    "size-3 text-muted-foreground shrink-0 transition-transform duration-150",
                    isExpanded && "rotate-90"
                  )}
                />
              </div>

              {/* 操作菜单 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "shrink-0 p-1 rounded opacity-0 group-hover:opacity-100",
                      "hover:bg-black/10 data-[state=open]:bg-black/10 data-[state=open]:opacity-100",
                      "transition-all"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="size-3 text-muted-foreground/50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-40">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNewSession(project);
                    }}
                    className="gap-2"
                  >
                    <Plus className="size-3.5" />
                    新建对话
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => e.stopPropagation()}
                    className="gap-2"
                  >
                    <Pencil className="size-3.5" />
                    编辑项目
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project.id, project.name);
                    }}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    删除项目
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 新建对话按钮 */}
              <button
                className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 transition-all"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNewSession(project);
                }}
                title="新建对话"
              >
                <SquarePen className="size-3 text-muted-foreground/50" />
              </button>
            </div>

            {/* 会话列表（展开后显示） */}
            {isExpanded && (
              <div className="space-y-0.5 mt-1">
                {projectSessions.length === 0 ? (
                  <div className="py-1.5 pr-3 pl-8">
                    <p className="text-xs text-muted-foreground">暂无对话</p>
                  </div>
                ) : (
                  [...projectSessions]
                    .sort((a, b) => {
                      // 置顶的会话排在最前面
                      const aPinned = a.pinnedAt ? 1 : 0;
                      const bPinned = b.pinnedAt ? 1 : 0;
                      if (aPinned !== bPinned) return bPinned - aPinned;
                      // 同状态按最近活跃时间排序
                      return b.lastActiveAt - a.lastActiveAt;
                    })
                    .map((sess) => {
                      const isSessionActive = currentSessionId === sess.sessionId;
                      const isPinned = !!sess.pinnedAt;
                      return (
                        <div
                          key={sess.sessionId}
                          className={cn(
                            "group flex items-center gap-1 py-1.5 pr-1 pl-8 rounded-md",
                            "hover:bg-[#EBEBED] transition-colors",
                            isSessionActive && "bg-[#EBEBED]"
                          )}
                        >
                          <button
                            onClick={() => handleSelectSession(project, sess)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <span className="text-sm truncate block">
                              {sess.title}
                            </span>
                          </button>
                          <SessionActionsMenu
                            projectId={project.id}
                            sessionId={sess.sessionId}
                            title={sess.title}
                            pinnedAt={sess.pinnedAt}
                            sidebarMode
                            isPinned={isPinned}
                          />
                        </div>
                      );
                    })
                )}
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}
