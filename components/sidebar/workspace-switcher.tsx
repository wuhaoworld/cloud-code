"use client";

import { useState, useEffect } from "react";
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

function SandboxIndicator({ status }: { status: SandboxStatus }) {
  if (status === "idle") return null;

  const config: Record<
    Exclude<SandboxStatus, "idle">,
    { color: string; pulse: boolean; label: string }
  > = {
    starting: { color: "bg-amber-400", pulse: true, label: "启动中" },
    running: { color: "bg-emerald-500", pulse: false, label: "运行中" },
    snapshotting: { color: "bg-blue-400", pulse: true, label: "快照中" },
  };

  const { color, pulse, label } = config[status as Exclude<SandboxStatus, "idle">];

  return (
    <span
      className="flex items-center gap-1 text-[10px] text-muted-foreground"
      title={`Sandbox ${label}`}
    >
      <span className={`inline-block size-1.5 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`} />
      <span className="hidden group-hover:inline">{label}</span>
    </span>
  );
}

export function WorkspaceSwitcher() {
  const { workspaces, currentWorkspaceId, setWorkspaces, addWorkspace, setCurrentWorkspace } =
    useAppStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/workspaces");
        if (!res.ok) return;
        const data: Workspace[] = await res.json();
        setWorkspaces(data);

        const savedId = typeof window !== "undefined"
          ? localStorage.getItem("current-workspace-id")
          : null;

        if (data.length > 0) {
          const target = savedId ? data.find((w) => w.id === savedId) : null;
          setCurrentWorkspace(target ? target.id : data[0].id);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = workspaces.find((w) => w.id === currentWorkspaceId);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
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
            <span className="font-semibold text-sm tracking-tight truncate flex-1 text-left">
              {loading ? "Cloud Code" : (current?.name ?? "Cloud Code")}
            </span>
            {current && current.sandboxStatus !== "idle" && (
              <SandboxIndicator status={current.sandboxStatus} />
            )}
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          {workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.id}
              onSelect={() => setCurrentWorkspace(ws.id)}
              className="flex items-center gap-2"
            >
              <div className="size-5 rounded shrink-0 bg-primary/10 flex items-center justify-center">
                <Sparkles className="size-3 text-primary" />
              </div>
              <span className="flex-1 truncate">{ws.name}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {ws.sandboxStatus !== "idle" && (
                  <SandboxIndicator status={ws.sandboxStatus} />
                )}
                {ws.id === currentWorkspaceId && (
                  <Check className="size-3.5 text-primary" />
                )}
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
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                取消
              </Button>
              <Button type="submit" disabled={creating || !newName.trim()}>
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
