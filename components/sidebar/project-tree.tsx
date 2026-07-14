"use client";

import { useEffect, useCallback, useState, useRef } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ProjectTreeProps {
  onNewSession?: (projectId: string) => void;
  initialProjects?: Project[];
  initialSessions?: Record<string, ProjectSession[]>;
}

export function ProjectTree({ onNewSession, initialProjects, initialSessions }: ProjectTreeProps) {
  const router = useRouter();
  const {
    projects,
    sessions,
    expandedProjects,
    currentProjectId,
    currentSessionId,
    currentWorkspaceId,
    setProjects,
    setSessions,
    removeProject,
    toggleProjectExpanded,
    setExpandedProjects,
    setCurrentProject,
    setCurrentSession,
    clearMessages,
  } = useAppStore();

  const routePrefix = currentWorkspaceId ? `/${currentWorkspaceId}/chat` : "/chat";

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

  async function loadProjects() {
    try {
      const url = currentWorkspaceId
        ? `/api/projects?workspaceId=${currentWorkspaceId}`
        : "/api/projects";
      const res = await fetch(url);
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
            } catch { /* ignore */ }
          }
        }
        if (!hasRecord) {
          expandedIds = [data[0].id];
        }
        const validExpandedIds = expandedIds.filter((id) => data.some((p: Project) => p.id === id));
        if (!hasRecord || validExpandedIds.length !== expandedIds.length) {
          if (typeof window !== "undefined") {
            localStorage.setItem("expanded-projects", JSON.stringify(validExpandedIds));
          }
        }
        setExpandedProjects(validExpandedIds);
        await Promise.all(
          data
            .filter((p: Project) => validExpandedIds.includes(p.id))
            .map((p: Project) => loadSessions(p.id))
        );
      }
    } catch { /* ignore */ }
  }

  // 首次 mount：注入服务端预取数据（如果有）
  const initializedRef = useRef<string | null>(null);
  useEffect(() => {
    // 只在 workspaceId 变化时重新初始化
    if (initializedRef.current === currentWorkspaceId) return;
    initializedRef.current = currentWorkspaceId;

    if (initialProjects && initialProjects.length > 0 && projects.length === 0) {
      // 服务端预取数据可用，直接写入 store
      setProjects(initialProjects);

      // 确定需要展开的项目
      let expandedIds: string[] = [];
      let hasRecord = false;
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("expanded-projects");
        if (stored !== null) {
          try {
            expandedIds = JSON.parse(stored);
            hasRecord = true;
          } catch { /* ignore */ }
        }
      }
      if (!hasRecord) {
        expandedIds = [initialProjects[0].id];
      }
      const validIds = expandedIds.filter((id) => initialProjects.some((p) => p.id === id));
      setExpandedProjects(validIds);

      // 注入预取的 sessions
      if (initialSessions) {
        Object.entries(initialSessions).forEach(([projectId, sessions]) => {
          setSessions(projectId, sessions);
        });
      }

      // 尚未预取 sessions 的已展开项目，补充拉取
      const missingIds = validIds.filter((id) => !initialSessions?.[id]);
      if (missingIds.length > 0) {
        Promise.all(missingIds.map((id) => loadSessions(id))).catch(() => {});
      }
      return;
    }

    // 无预取数据或 store 已有数据时，从服务端拉取
    if (projects.length > 0) return; // store 中已有数据（如 WorkspaceSync 注入了），跳过
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkspaceId]);



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
    router.push(`${routePrefix}/${project.id}/${session.sessionId}`);
  };

  const handleNewSession = (project: Project) => {
    setCurrentProject(project.id);
    setCurrentSession(null);
    clearMessages();
    router.push(routePrefix);
    onNewSession?.(project.id);
  };

  // 记录哪些项目展开了全部会话（超过 5 个时使用）
  const [expandedAllSessions, setExpandedAllSessions] = useState<Set<string>>(new Set());

  const [deleteProjectInfo, setDeleteProjectInfo] = useState<{
    id: string;
    name: string;
  } | null>(null);

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
        router.push(routePrefix);
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
                      setDeleteProjectInfo({ id: project.id, name: project.name });
                    }}
                    className="gap-2"
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
            {isExpanded && (() => {
              const sortedSessions = [...projectSessions].sort((a, b) => {
                // 置顶的会话排在最前面
                const aPinned = a.pinnedAt ? 1 : 0;
                const bPinned = b.pinnedAt ? 1 : 0;
                if (aPinned !== bPinned) return bPinned - aPinned;
                // 同状态按最近活跃时间排序
                return b.lastActiveAt - a.lastActiveAt;
              });
              const SESSION_LIMIT = 5;
              const hasMore = sortedSessions.length > SESSION_LIMIT;
              const isAllExpanded = expandedAllSessions.has(project.id);
              const visibleSessions = hasMore && !isAllExpanded
                ? sortedSessions.slice(0, SESSION_LIMIT)
                : sortedSessions;

              return (
                <div className="space-y-0.5 mt-1">
                  {sortedSessions.length === 0 ? (
                    <div className="py-1.5 pr-3 pl-8">
                      <p className="text-xs text-muted-foreground">暂无对话</p>
                    </div>
                  ) : (
                    <>
                      {visibleSessions.map((sess) => {
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
                      })}
                      {hasMore && (
                        <button
                          className="w-full py-1.5 pl-8 pr-1 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedAllSessions((prev) => {
                              const next = new Set(prev);
                              if (next.has(project.id)) {
                                next.delete(project.id);
                              } else {
                                next.add(project.id);
                              }
                              return next;
                            });
                          }}
                        >
                          {isAllExpanded ? "折叠展示" : "展开全部"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}

      {/* 删除项目确认对话框 */}
      <Dialog
        open={!!deleteProjectInfo}
        onOpenChange={(open) => {
          if (!open) setDeleteProjectInfo(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除项目</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要删除项目「{deleteProjectInfo?.name}」吗？该项目下的所有对话将一并删除，此操作无法撤销。
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteProjectInfo(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteProjectInfo) {
                  handleDeleteProject(deleteProjectInfo.id, deleteProjectInfo.name);
                  setDeleteProjectInfo(null);
                }
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
