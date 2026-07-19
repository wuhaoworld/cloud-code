"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronsUpDown, Loader2, Plus, Sparkles, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Label } from "@/components/ui/label";
import { useAppStore, type Workspace } from "@/store/app-store";

type SandboxStatus = Workspace["sandboxStatus"];

const RESERVED_PATHS = new Set([
  "login",
  "admin",
  "signout",
  "signin",
  "signup",
  "sign-in",
  "sign-up",
  "api",
  "chat",
  "plugins",
  "settings",
  "forgot-password",
  "reset-password",
  "w",
  "favicon.ico",
  "logo.png"
]);

function SandboxIndicator({ status, showLabel = false }: { status: SandboxStatus | "error"; showLabel?: boolean }) {
  const config: Record<
    SandboxStatus | "error",
    { color: string; pulse: boolean; label: string }
  > = {
    running: { color: "bg-emerald-500", pulse: false, label: "运行中" },
    idle: { color: "bg-zinc-400 dark:bg-zinc-500", pulse: false, label: "已停止" },
    starting: { color: "bg-amber-500", pulse: true, label: "启动中" },
    snapshotting: { color: "bg-amber-500", pulse: true, label: "快照中" },
    error: { color: "bg-red-500", pulse: false, label: "错误" },
  };

  const item = config[status] || { color: "bg-zinc-400 dark:bg-zinc-500", pulse: false, label: "未知" };

  return (
    <span
      className="inline-flex items-center gap-1.5 shrink-0 ml-1.5"
      title={`Workspace ${item.label}`}
    >
      <span className={`inline-block size-1.5 rounded-full ${item.color} ${item.pulse ? "animate-pulse" : ""}`} />
      {showLabel && (
        <span className="text-[11px] text-muted-foreground">{item.label}</span>
      )}
    </span>
  );
}

export function WorkspaceSwitcher() {
  const router = useRouter();
  const workspaces = useAppStore((state) => state.workspaces);
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId);
  const addWorkspace = useAppStore((state) => state.addWorkspace);
  const setCurrentWorkspace = useAppStore((state) => state.setCurrentWorkspace);
  const updateWorkspace = useAppStore((state) => state.updateWorkspace);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newId, setNewId] = useState("");
  const [urlPrefix] = useState(() => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/`;
    }
    return "/";
  });
  const [creating, setCreating] = useState(false);

  const autoStartAttemptsRef = useRef(new Set<string>());

  const updateSandboxStatus = useCallback(
    (workspaceId: string, sandboxStatus: SandboxStatus) => {
      const workspace = useAppStore
        .getState()
        .workspaces.find((item) => item.id === workspaceId);

      // Do not replace the store array when the server has no new information.
      // Replacing it would re-render subscribers and previously re-triggered
      // the auto-start effect indefinitely.
      if (workspace && workspace.sandboxStatus !== sandboxStatus) {
        updateWorkspace(workspaceId, { sandboxStatus });
      }
    },
    [updateWorkspace]
  );

  // Poll sandbox status of workspaces in a transition state. The cancellation
  // guard prevents an in-flight tick from scheduling a new timer after Fast
  // Refresh or unmount has already cleaned up this effect.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let elapsedMs = 0;
    let disposed = false;
    const controller = new AbortController();

    const getNextDelay = (elapsed: number) => {
      if (elapsed < 15_000) return 5_000;
      return 10_000;
    };

    const schedule = (delay: number) => {
      if (!disposed) {
        timeoutId = setTimeout(() => void tick(), delay);
      }
    };

    const tick = async () => {
      if (disposed) return;

      const transitioning = useAppStore
        .getState()
        .workspaces.filter(
          (ws) => ws.sandboxStatus === "starting" || ws.sandboxStatus === "snapshotting"
        );

      if (transitioning.length === 0) {
        elapsedMs = 0;
        schedule(5_000);
        return;
      }

      await Promise.all(
        transitioning.map(async (ws) => {
          try {
            const res = await fetch(`/api/workspaces/${ws.id}/sandbox`, {
              signal: controller.signal,
            });
            if (res.ok && !disposed) {
              const data = (await res.json()) as { sandboxStatus?: SandboxStatus };
              if (data.sandboxStatus) {
                updateSandboxStatus(ws.id, data.sandboxStatus);
              }
            }
          } catch (err) {
            if (!controller.signal.aborted) {
              console.error(`Failed to poll sandbox status for ${ws.id}:`, err);
            }
          }
        })
      );

      if (disposed) return;

      const delay = getNextDelay(elapsedMs);
      elapsedMs += delay;
      schedule(delay);
    };

    schedule(5_000);

    return () => {
      disposed = true;
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [updateSandboxStatus]);

  // Auto-start only a workspace that is locally idle. The effect deliberately
  // does not depend on `workspaces`: status writes must not start another sync.
  useEffect(() => {
    if (!currentWorkspaceId) return;

    const workspace = useAppStore
      .getState()
      .workspaces.find((item) => item.id === currentWorkspaceId);
    if (!workspace || workspace.sandboxStatus !== "idle") return;

    const autoStartAttempts = autoStartAttemptsRef.current;
    if (autoStartAttempts.has(currentWorkspaceId)) return;

    let disposed = false;
    const controller = new AbortController();

    const syncAndStart = async () => {
      autoStartAttempts.add(currentWorkspaceId);

      try {
        const res = await fetch(`/api/workspaces/${currentWorkspaceId}/sandbox`, {
          signal: controller.signal,
        });
        if (!res.ok || disposed) return;

        const data = (await res.json()) as { sandboxStatus?: SandboxStatus };
        if (!data.sandboxStatus || disposed) return;

        updateSandboxStatus(currentWorkspaceId, data.sandboxStatus);
        if (data.sandboxStatus !== "idle") return;

        updateSandboxStatus(currentWorkspaceId, "starting");
        const startRes = await fetch(`/api/workspaces/${currentWorkspaceId}/sandbox`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
          signal: controller.signal,
        });

        if (disposed) return;

        if (!startRes.ok) {
          updateSandboxStatus(currentWorkspaceId, "idle");
          autoStartAttempts.delete(currentWorkspaceId);
          return;
        }

        const startData = (await startRes.json()) as { sandboxStatus?: SandboxStatus };
        if (startData.sandboxStatus && !disposed) {
          updateSandboxStatus(currentWorkspaceId, startData.sandboxStatus);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Failed to sync and start sandbox:", err);
          updateSandboxStatus(currentWorkspaceId, "idle");
          autoStartAttempts.delete(currentWorkspaceId);
        }
      }
    };

    // Fast Refresh runs effects even when dependencies did not change. Deferring
    // the request lets its cleanup cancel the development-only probe first.
    const timeoutId = setTimeout(() => void syncAndStart(), 0);

    return () => {
      disposed = true;
      clearTimeout(timeoutId);
      controller.abort();
      // Allow a remounted/Fast Refreshed effect to retry an aborted request.
      autoStartAttempts.delete(currentWorkspaceId);
    };
  }, [currentWorkspaceId, updateSandboxStatus]);

  const current = workspaces.find((w) => w.id === currentWorkspaceId);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newId.trim()) return;

    const cleanId = newId.trim();

    if (RESERVED_PATHS.has(cleanId.toLowerCase())) {
      toast.error("该 Workspace ID 是系统保留路径，无法使用");
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
      toast.error("Workspace ID 只能包含字母、数字、连字符和下划线");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          id: cleanId,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error || "创建失败");
        return;
      }
      const workspace: Workspace = await res.json();
      addWorkspace(workspace);
      setCurrentWorkspace(workspace.id);
      toast.success(`Workspace "${workspace.name}" 已创建`);
      setCreateOpen(false);
      setNewName("");
      setNewId("");
      router.push(`/${workspace.id}/chat`);
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="group flex items-center gap-1.5 flex-1 min-w-0 rounded-md hover:bg-[#EBEBED] px-2 py-2 -mx-2 transition-colors">
            <div className="size-6 shrink-0 rounded-md bg-primary flex items-center justify-center">
              <Sparkles className="size-3.5 text-primary-foreground" />
            </div>
            <div className="flex items-center gap-1 min-w-0 flex-1 text-left">
              <span className="font-semibold text-sm tracking-tight truncate">
                {current?.name ?? "Cloud Code"}
              </span>
              {current && (
                <SandboxIndicator status={current.sandboxStatus} />
              )}
            </div>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          {workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.id}
              onSelect={() => {
                setCurrentWorkspace(ws.id);
                router.push(`/${ws.id}/chat`);
              }}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <div className="size-5 rounded shrink-0 bg-primary/10 flex items-center justify-center">
                  <Sparkles className="size-3 text-primary" />
                </div>
                <span className="truncate font-medium">{ws.name}</span>
                {ws.id === currentWorkspaceId && (
                  <Check className="size-3.5 text-primary shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <SandboxIndicator status={ws.sandboxStatus} showLabel />
              </div>
            </DropdownMenuItem>
          ))}

          {workspaces.length > 0 && <DropdownMenuSeparator />}

          <DropdownMenuItem
            onSelect={() => setCreateOpen(true)}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <Plus className="size-4 shrink-0" />
            新建 Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              新建 Workspace
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">名称</Label>
              <Input
                id="ws-name"
                placeholder="My Workspace"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-id">Workspace ID (URL 路由)</Label>
              <div className="flex h-9 w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 overflow-hidden dark:bg-input/30 md:text-sm">
                <span className="flex items-center bg-muted/50 px-3 text-muted-foreground border-r border-input select-none font-mono text-[12px] h-full whitespace-nowrap">
                  {urlPrefix || "/w/"}
                </span>
                <input
                  id="ws-id"
                  placeholder="my-workspace"
                  value={newId}
                  onChange={(e) => {
                    const sanitized = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
                    setNewId(sanitized);
                  }}
                  className="flex-1 min-w-0 bg-transparent px-2.5 py-1 text-base outline-none md:text-sm text-foreground placeholder:text-muted-foreground"
                  required
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                只能包含小写字母、数字、连字符和下划线。
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                取消
              </Button>
              <Button type="submit" disabled={creating || !newName.trim() || !newId.trim()}>
                {creating && <Loader2 className="size-4 animate-spin mr-1.5" />}
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
