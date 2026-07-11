"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Settings, Trash2, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

// ── Left-side nav items ─────────────────────────────────────────────────────

type NavItem = {
  id: string;
  label: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "通用", icon: Settings },
];

// ── General Settings Panel ──────────────────────────────────────────────────

function GeneralPanel() {
  const router = useRouter();
  const { workspaces, currentWorkspaceId, removeWorkspace } = useAppStore();
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!currentWorkspaceId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspaces/${currentWorkspaceId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as { error?: string }).error || "删除失败，请重试");
        return;
      }

      toast.success(`Workspace "${currentWorkspace?.name ?? ""}" 已删除`);
      removeWorkspace(currentWorkspaceId);
      setDeleteOpen(false);

      // Navigate away after deletion
      router.push("/chat");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Workspace Info */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-1">Workspace 信息</h2>
        <p className="text-sm text-muted-foreground mb-4">当前 Workspace 的基本信息</p>
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Sparkles className="size-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm text-foreground truncate">
                {currentWorkspace?.name ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground font-mono truncate">
                {currentWorkspace?.id ?? "—"}
              </p>
            </div>
          </div>
          {currentWorkspace && (
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Sandbox 状态</p>
                <SandboxStatusBadge status={currentWorkspace.sandboxStatus} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">创建时间</p>
                <p className="text-xs font-medium text-foreground">
                  {new Date(currentWorkspace.createdAt).toLocaleDateString("zh-CN", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Danger Zone */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-1">危险操作</h2>
        <p className="text-sm text-muted-foreground mb-4">
          以下操作不可撤销，请谨慎操作
        </p>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm text-foreground mb-0.5">删除此 Workspace</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                永久删除此 Workspace 及其所有项目、聊天记录。
                对应的 Sandbox 和 Snapshot 也会一并删除，此操作无法撤销。
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              onClick={() => setDeleteOpen(true)}
              id="workspace-delete-btn"
            >
              <Trash2 className="size-3.5 mr-1.5" />
              删除 Workspace
            </Button>
          </div>
        </div>
      </section>

      {/* Confirm Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              确认删除 Workspace
            </DialogTitle>
            <DialogDescription className="pt-1 space-y-2">
              <span className="block">
                你即将删除 Workspace{" "}
                <span className="font-semibold text-foreground">
                  &ldquo;{currentWorkspace?.name}&rdquo;
                </span>
                。
              </span>
              <span className="block text-destructive/80 font-medium">
                此操作将永久删除：
              </span>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>所有关联项目</li>
                <li>所有聊天记录</li>
                <li>对应的 Sandbox 实例</li>
                <li>所有 Sandbox Snapshot</li>
              </ul>
              <span className="block font-semibold text-destructive">
                此操作无法撤销。
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              id="workspace-delete-confirm-btn"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin mr-1.5" />
              ) : (
                <Trash2 className="size-3.5 mr-1.5" />
              )}
              {deleting ? "正在删除…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SandboxStatusBadge({
  status,
}: {
  status: "idle" | "starting" | "running" | "snapshotting";
}) {
  const config: Record<
    typeof status,
    { label: string; color: string; dot: string }
  > = {
    idle: { label: "空闲", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
    starting: { label: "启动中", color: "text-amber-600", dot: "bg-amber-400 animate-pulse" },
    running: { label: "运行中", color: "text-emerald-600", dot: "bg-emerald-500" },
    snapshotting: { label: "快照中", color: "text-blue-600", dot: "bg-blue-400 animate-pulse" },
  };
  const { label, color, dot } = config[status];
  return (
    <span className={cn("flex items-center gap-1.5 text-xs font-medium", color)}>
      <span className={cn("inline-block size-1.5 rounded-full shrink-0", dot)} />
      {label}
    </span>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function WorkspaceSettingsPage() {
  const [activeNav, setActiveNav] = useState("general");

  return (
    <div className="flex h-full">
      {/* Left nav */}
      <nav className="w-52 shrink-0 border-r border-border bg-sidebar flex flex-col py-4 px-2 gap-0.5">
        <p className="px-3 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Workspace 设置
        </p>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            id={`settings-nav-${item.id}`}
            onClick={() => setActiveNav(item.id)}
            className={cn(
              "flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors text-left",
              activeNav === item.id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-foreground hover:bg-[#EBEBED]"
            )}
          >
            <item.icon className="size-4 text-muted-foreground shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-2xl mx-auto px-8 py-8">
          {activeNav === "general" && <GeneralPanel />}
        </div>
      </div>
    </div>
  );
}
