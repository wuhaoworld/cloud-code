"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Plus,
  Search,
  Settings,
  Sparkles,
  MessageSquarePlus,
} from "lucide-react";
import { ProjectTree } from "@/components/sidebar/project-tree";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { useAppStore } from "@/store/app-store";

export function AppSidebar() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const { setCurrentProject, setCurrentSession, clearMessages } = useAppStore();

  const handleNewChat = () => {
    setCurrentProject(null);
    setCurrentSession(null);
    clearMessages();
    router.push("/chat");
  };

  return (
    <aside className="flex flex-col h-full bg-sidebar border-r border-sidebar-border select-none">
      {/* 顶部 Logo + 新对话 */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <div className="flex items-center gap-1.5 flex-1">
          <div className="size-6 rounded-md bg-primary flex items-center justify-center">
            <Sparkles className="size-3.5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm tracking-tight">
            Cloud Claude
          </span>
        </div>
      </div>

      {/* 快捷操作区 */}
      <div className="px-2 py-1 space-y-0.5">
        <button
          onClick={handleNewChat}
          className={cn(
            "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md",
            "text-sm text-foreground hover:bg-accent/60 transition-colors"
          )}
          id="sidebar-new-chat-btn"
        >
          <MessageSquarePlus className="size-4 text-muted-foreground" />
          新对话
        </button>
        <button
          className={cn(
            "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md",
            "text-sm text-foreground hover:bg-accent/60 transition-colors"
          )}
        >
          <Search className="size-4 text-muted-foreground" />
          搜索
        </button>
      </div>

      {/* 项目区 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between pl-5 pr-3 py-1">
          <span className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
            项目
          </span>
          <button
            onClick={() => setCreateOpen(true)}
            className="size-5 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            id="sidebar-new-project-btn"
            title="新建项目"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-1">
          <ProjectTree onNewSession={() => {}} />
        </div>
      </div>

      {/* 底部设置 + 升级 */}
      <div className="px-2 py-3 space-y-0.5">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-default",
            "text-sm text-foreground hover:bg-[#E8EBEB] transition-colors"
          )}
        >
          <Settings className="size-4 text-muted-foreground" />
          设置
        </Link>

      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </aside>
  );
}
