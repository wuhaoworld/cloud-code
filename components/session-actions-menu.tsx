"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Trash2, Pencil, Pin } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/app-store";
import { toast } from "sonner";

interface SessionActionsMenuProps {
  projectId: string;
  sessionId: string;
  title: string;
  pinnedAt?: number | null;
  /** 侧边栏模式：隐藏直到 hover 或菜单打开 */
  sidebarMode?: boolean;
  /** 是否处于置顶状态（用于侧边栏模式的显隐逻辑） */
  isPinned?: boolean;
  className?: string;
}

export function SessionActionsMenu({
  projectId,
  sessionId,
  title,
  pinnedAt,
  sidebarMode = false,
  isPinned = false,
  className,
}: SessionActionsMenuProps) {
  const router = useRouter();
  const { updateSession, removeSession, currentSessionId } = useAppStore();

  const [open, setOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleTogglePin = async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/sessions/${sessionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: !pinnedAt }),
        }
      );
      if (!res.ok) {
        toast.error(pinnedAt ? "取消置顶失败" : "置顶失败");
        return;
      }
      updateSession(projectId, sessionId, {
        pinnedAt: pinnedAt ? null : Date.now(),
      });
      toast.success(pinnedAt ? "已取消置顶" : "已置顶");
    } catch {
      toast.error("网络错误");
    }
  };

  const handleRename = async () => {
    if (!renameValue.trim()) return;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/sessions/${sessionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: renameValue.trim() }),
        }
      );
      if (!res.ok) {
        toast.error("重命名失败");
        return;
      }
      updateSession(projectId, sessionId, { title: renameValue.trim() });
      setRenameOpen(false);
    } catch {
      toast.error("网络错误");
    }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        toast.error("删除失败");
        return;
      }
      removeSession(projectId, sessionId);
      toast.success(`对话 "${title}" 已删除`);
      if (currentSessionId === sessionId) {
        router.push(`/chat/${projectId}`);
      }
    } catch {
      toast.error("网络错误");
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              sidebarMode
                ? cn(
                    "shrink-0 p-1 rounded",
                    isPinned
                      ? "hidden group-hover:block hover:bg-black/10 data-[state=open]:block data-[state=open]:bg-black/10"
                      : "opacity-0 group-hover:opacity-100 hover:bg-black/10 data-[state=open]:bg-black/10 data-[state=open]:opacity-100",
                    "transition-all"
                  )
                : "shrink-0 p-1 rounded hover:bg-accent data-[state=open]:bg-accent transition-colors",
              className
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal
              className={cn(
                "text-muted-foreground/50",
                sidebarMode ? "size-3" : "size-4"
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent  className="w-36">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              handleTogglePin();
            }}
            className="gap-2"
          >
            <Pin className="size-3.5" />
            {pinnedAt ? "取消置顶" : "置顶"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              setRenameValue(title);
              setRenameOpen(true);
            }}
            className="gap-2"
          >
            <Pencil className="size-3.5" />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              setDeleteOpen(true);
            }}
            className="gap-2"
          >
            <Trash2 className="size-3.5" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 重命名对话框 */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
            placeholder="输入新名称"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button onClick={handleRename}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除对话</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要删除对话「{title}」吗？此操作无法撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false);
                handleDelete();
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
