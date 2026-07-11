"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { setCurrentProject, setCurrentSession, clearMessages } = useAppStore();
  const isPluginsActive = pathname === "/plugins" || pathname.startsWith("/plugins/");
  const isSettingsActive = pathname === "/chat/settings" || pathname.startsWith("/chat/settings/");

  const handleNewChat = () => {
    setCurrentProject(null);
    setCurrentSession(null);
    clearMessages();
    router.push("/chat");
  };

  return (
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
            router.push("/plugins");
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
          <ProjectTree onNewSession={() => {}} />
        </div>
      </div>

      {/* 底部设置 + 升级 */}
      <div className="px-2 py-3 space-y-0.5">
        <button
          onClick={() => {
            router.push("/chat/settings");
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
  );
}
