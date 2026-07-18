"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Loader2, Box } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useAppStore } from "@/store/app-store";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
}: CreateProjectDialogProps) {
  const addProject = useAppStore((s) => s.addProject);
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    path: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.path.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...(currentWorkspaceId ? { workspaceId: currentWorkspaceId } : {}),
        }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error || "创建失败");
        return;
      }

      const project = await res.json();
      addProject(project);
      toast.success(`项目 "${project.name}" 创建成功`);
      onOpenChange(false);
      setForm({ name: "", path: "" });
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="size-4 text-primary" />
            新建项目
          </DialogTitle>
          <DialogDescription>
            当前 Workspace 运行在 Sandbox 中，路径为 sandbox 内的相对目录
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">项目名称 *</Label>
            <Input
              id="project-name"
              placeholder="My Awesome Project"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-path" className="flex items-center gap-1.5">
              <Box className="size-3.5 text-emerald-600" />
              Sandbox 目录名 *
            </Label>
            <Input
              id="project-path"
              placeholder="my-project"
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
              className="font-mono text-sm"
              required
            />
            <p className="text-xs text-muted-foreground">
              在 sandbox 内映射为 /workspace/{"<"}目录名{">"}，仅限字母、数字和连字符
            </p>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={loading || !form.name || !form.path}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin mr-1.5" />
              ) : null}
              创建项目
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
