"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import { ChatInput } from "@/components/chat/chat-input";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { Folder, FolderOpen, ChevronDown, Check, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface WelcomeChatProps {
  /** 从 URL 传入的默认项目 ID，用于预选项目 */
  defaultProjectId?: string;
}

export function WelcomeChat({ defaultProjectId }: WelcomeChatProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const { projects, currentProjectId, setCurrentProject } = useAppStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    defaultProjectId ?? null
  );

  // 当 defaultProjectId 变化时同步选中状态
  useEffect(() => {
    if (defaultProjectId) {
      setSelectedProjectId(defaultProjectId);
      setCurrentProject(defaultProjectId);
    }
  }, [defaultProjectId, setCurrentProject]);

  // 计算当前生效的项目 ID
  const activeProjectId =
    selectedProjectId ||
    (currentProjectId && projects.some((p) => p.id === currentProjectId)
      ? currentProjectId
      : projects.length > 0
      ? projects[0].id
      : null);

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setCurrentProject(projectId);
  };

  const handleSend = (prompt: string) => {
    if (!activeProjectId) {
      toast.error("请先选择或创建一个项目");
      return;
    }
    // 重定向到项目的 chat 页面，并通过 query 参数传递 prompt
    router.push(`/chat/${activeProjectId}?prompt=${encodeURIComponent(prompt)}`);
  };

  const selectedProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full bg-background pb-32">
      <div className="w-full max-w-[680px] px-6 flex flex-col items-center gap-8 animate-[fadeUp_0.35s_ease]">
        {/* H1 标题 */}
        <h1 className="text-[28px] font-normal dark:text-[#e8e3d8] text-[#2d2b26] text-center tracking-[-0.3px] m-0 leading-snug">
          有什么我能帮你的吗？
        </h1>

        {/* 聊天输入框 */}
        <div className="w-full">
          <ChatInput
            onSend={handleSend}
            placeholder="询问任何事。输入 @ 使用插件或提及文件"
            projectId={activeProjectId}
            projectSelector={
              <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12.5px] dark:text-white/55 text-black/45 dark:hover:bg-white/[0.06] hover:bg-black/[0.05] dark:hover:text-white/75 hover:text-black/65 transition-all outline-none">
                      <FolderOpen size={13} className="opacity-65 shrink-0" />
                      <span className="max-w-[150px] truncate">
                        {selectedProject ? selectedProject.name : "选择项目"}
                      </span>
                      <ChevronDown
                        size={11}
                        className="opacity-50 transition-transform [[data-state=open]_&]:rotate-180"
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 p-1">
                    <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground/70 px-2 py-1">
                      切换当前项目
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {projects.length === 0 ? (
                      <div className="text-[12px] text-muted-foreground/60 px-3 py-2 text-center">
                        无可用项目
                      </div>
                    ) : (
                      <div className="max-h-60 overflow-y-auto space-y-0.5">
                        {projects.map((proj) => (
                          <DropdownMenuItem
                            key={proj.id}
                            onClick={() => handleSelectProject(proj.id)}
                            className={cn(
                              "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] cursor-pointer",
                              proj.id === activeProjectId && "bg-accent text-accent-foreground"
                            )}
                          >
                            <Folder className="size-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate flex-1">{proj.name}</span>
                            {proj.id === activeProjectId && (
                              <Check className="size-3.5 ml-auto text-primary shrink-0" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </div>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setCreateOpen(true)}
                      className="gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-primary focus:text-primary cursor-pointer"
                    >
                      <Plus className="size-3.5" />
                      新建项目
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
            }
          />
        </div>
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
