"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

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

export function OnboardingClient() {
  const router = useRouter();
  const { addWorkspace, setCurrentWorkspace } = useAppStore();

  const [newName, setNewName] = useState("");
  const [newId, setNewId] = useState("");
  const [urlPrefix] = useState(() => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/`;
    }
    return "/";
  });
  const [creating, setCreating] = useState(false);

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
      const workspace = await res.json();
      addWorkspace(workspace);
      setCurrentWorkspace(workspace.id);
      toast.success(`Workspace "${workspace.name}" 已创建`);
      router.push(`/${workspace.id}/chat`);
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center h-full bg-background p-6">
      <div className="w-full max-w-sm border border-border/60 bg-card rounded-xl p-6 shadow-lg space-y-6">
        <div className="space-y-1.5 text-center">
          <div className="size-10 rounded-lg bg-primary mx-auto flex items-center justify-center mb-2 shadow-xs">
            <Sparkles className="size-5 text-primary-foreground animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground">
            创建您的第一个 Workspace
          </p>
        </div>

        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="first-ws-name">名称</Label>
            <Input
              id="first-ws-name"
              placeholder="My Workspace"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              required
              disabled={creating}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="first-ws-id">Workspace ID (URL 路由)</Label>
            <div className="flex h-9 w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 overflow-hidden dark:bg-input/30 md:text-sm">
              <span className="flex items-center bg-muted/50 px-3 text-muted-foreground border-r border-input select-none font-mono text-[12px] h-full whitespace-nowrap">
                {urlPrefix || "/w/"}
              </span>
              <input
                id="first-ws-id"
                placeholder="my-workspace"
                value={newId}
                onChange={(e) => {
                  const sanitized = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
                  setNewId(sanitized);
                }}
                className="flex-1 min-w-0 bg-transparent px-2.5 py-1 text-base outline-none md:text-sm text-foreground placeholder:text-muted-foreground"
                required
                disabled={creating}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              只能包含小写字母、数字、连字符和下划线。
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={creating || !newName.trim() || !newId.trim()}>
            {creating ? (
              <>
                <Loader2 className="size-4 animate-spin mr-1.5" />
                正在创建...
              </>
            ) : (
              "创建 Workspace"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
