"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter, useParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FolderPlus,
  LayoutGrid,
  Search,
  Settings,
  MessageSquarePlus,
} from "lucide-react";
import { ProjectTree } from "@/components/sidebar/project-tree";
import { SearchPanel } from "@/components/sidebar/search-panel";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { WorkspaceSwitcher } from "@/components/sidebar/workspace-switcher";
import { useAppStore } from "@/store/app-store";
import type { Project, ProjectSession } from "@/store/app-store";

interface AppSidebarProps {
  initialProjects?: Project[];
  initialSessions?: Record<string, ProjectSession[]>;
}

export function AppSidebar({ initialProjects, initialSessions }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const workspaceId = params?.workspace as string | undefined;
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const setCurrentProject = useAppStore((state) => state.setCurrentProject);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const clearMessages = useAppStore((state) => state.clearMessages);
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId);
  const setCurrentWorkspace = useAppStore((state) => state.setCurrentWorkspace);

  useEffect(() => {
    setCurrentWorkspace(workspaceId || null);
  }, [workspaceId, setCurrentWorkspace]);

  const isPluginsActive = currentWorkspaceId && (pathname === `/${currentWorkspaceId}/plugins` || pathname.startsWith(`/${currentWorkspaceId}/plugins/`));
  const isSettingsActive = currentWorkspaceId && (pathname === `/${currentWorkspaceId}/settings` || pathname.startsWith(`/${currentWorkspaceId}/settings/`));
  const routePrefix = currentWorkspaceId ? `/${currentWorkspaceId}/chat` : "/chat";

  const handleNewChat = () => {
    setCurrentProject(null);
    setCurrentSession(null);
    clearMessages();
    router.push(routePrefix);
  };

  const isSettings = pathname.endsWith("/settings") || pathname.includes("/settings/");
  if (isSettings) return null;

  return (
    <div className="w-76 shrink-0 flex flex-col h-full">
      <aside className="flex flex-col h-full bg-sidebar border-r border-border/60 select-none">
        {/* 顶部 Workspace 切换 */}
        <div className="flex items-center gap-2 px-4 pt-2 pb-1">
          <WorkspaceSwitcher />
        </div>

        {/* 快捷操作区 */}
        <div className="px-2 py-1 space-y-0.5">
          <button
            onClick={handleNewChat}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md",
              "text-sm text-foreground hover:bg-[#EBEBED] transition-colors"
            )}
            id="sidebar-new-chat-btn"
          >
            <MessageSquarePlus className="size-4 text-muted-foreground" />
            新对话
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md",
              "text-sm text-foreground hover:bg-[#EBEBED] transition-colors"
            )}
            id="sidebar-search-btn"
          >
            <Search className="size-4 text-muted-foreground" />
            搜索
          </button>
          <button
            onClick={() => {
              setCurrentProject(null);
              setCurrentSession(null);
              clearMessages();
              router.push(currentWorkspaceId ? `/${currentWorkspaceId}/plugins` : "/chat");
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md",
              "text-sm text-foreground hover:bg-[#EBEBED] transition-colors cursor-default",
              isPluginsActive && "bg-[#EBEBED]"
            )}
            id="sidebar-plugins-link"
          >
            <LayoutGrid className="size-4 text-muted-foreground" />
            插件
          </button>
        </div>

        {/* 项目区 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="group flex items-center justify-between pl-5 pr-3 py-1">
            <span className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
              项目
            </span>
            <button
              onClick={() => setCreateOpen(true)}
              className="size-5 flex items-center justify-center rounded hover:bg-[#EBEBED] text-muted-foreground hover:text-foreground transition opacity-0 group-hover:opacity-100"
              id="sidebar-new-project-btn"
              title="新建项目"
            >
              <FolderPlus className="size-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-1">
            <ProjectTree
              onNewSession={() => {}}
              initialProjects={initialProjects}
              initialSessions={initialSessions}
            />
          </div>
        </div>

        {/* 底部设置 */}
        <div className="px-2 py-3 space-y-0.5">
          <button
            onClick={() => {
              router.push(currentWorkspaceId ? `/${currentWorkspaceId}/settings` : "/chat");
            }}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-default",
              "text-sm text-foreground hover:bg-[#EBEBED] transition-colors",
              isSettingsActive && "bg-[#EBEBED]"
            )}
            id="sidebar-settings-btn"
          >
            <Settings className="size-4 text-muted-foreground" />
            设置
          </button>
        </div>

        <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
        {searchOpen ? (
          <SearchPanel open={searchOpen} onOpenChange={setSearchOpen} />
        ) : null}
      </aside>
    </div>
  );
}
