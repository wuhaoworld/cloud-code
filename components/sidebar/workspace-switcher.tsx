"use client";

import { useState, useEffect } from "react";
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

function SandboxIndicator({ status }: { status: SandboxStatus | "error" }) {
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
      className="inline-flex items-center shrink-0 ml-1.5"
      title={`Workspace ${item.label}`}
    >
      <span className={`inline-block size-1.5 rounded-full ${item.color} ${item.pulse ? "animate-pulse" : ""}`} />
    </span>
  );
}

export function WorkspaceSwitcher() {
  const router = useRouter();
  const { workspaces, currentWorkspaceId, setWorkspaces, addWorkspace, setCurrentWorkspace } =
    useAppStore();
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/workspaces");
        if (!res.ok) return;
        const data: Workspace[] = await res.json();
        setWorkspaces(data);

        // If path already contains /[workspaceId]/chat, that is handled by WorkspaceSync.
        // Otherwise, load last saved workspace from localStorage.
        const pathMatch = window.location.pathname.match(/^\/([^/]+)/);
        const matchedSlug = pathMatch ? pathMatch[1] : null;
        const urlWorkspaceId = (matchedSlug && !RESERVED_PATHS.has(matchedSlug.toLowerCase())) ? matchedSlug : null;

        const savedId = urlWorkspaceId || (typeof window !== "undefined"
          ? localStorage.getItem("current-workspace-id")
          : null);

        if (data.length > 0) {
          const target = savedId ? data.find((w) => w.id === savedId) : null;
          const targetId = target ? target.id : data[0].id;
          setCurrentWorkspace(targetId);
          
          // If we are on /chat without a workspace prefix, redirect to the workspace route
          if (window.location.pathname === "/chat" || window.location.pathname === "/chat/") {
            router.replace(`/${targetId}/chat`);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

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
                {loading ? "Cloud Code" : (current?.name ?? "Cloud Code")}
              </span>
              {!loading && current && (
                <SandboxIndicator status={current.sandboxStatus} />
              )}
            </div>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          {workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.id}
              onSelect={() => {
                setCurrentWorkspace(ws.id);
                router.push(`/${ws.id}/chat`);
              }}
              className="flex items-center gap-2"
            >
              <div className="size-5 rounded shrink-0 bg-primary/10 flex items-center justify-center">
                <Sparkles className="size-3 text-primary" />
              </div>
              <div className="flex items-center gap-1 min-w-0 flex-1 text-left">
                <span className="truncate">{ws.name}</span>
                <SandboxIndicator status={ws.sandboxStatus} />
              </div>
              {ws.id === currentWorkspaceId && (
                <Check className="size-3.5 shrink-0 text-primary" />
              )}
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
