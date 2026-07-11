"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, type Workspace } from "@/store/app-store";
import { Loader2 } from "lucide-react";

export default function LegacyPluginsPage() {
  const router = useRouter();
  const { workspaces, currentWorkspaceId, setWorkspaces, setCurrentWorkspace } = useAppStore();

  useEffect(() => {
    async function loadAndRedirect() {
      let targetId = currentWorkspaceId;

      if (!targetId) {
        try {
          const res = await fetch("/api/workspaces");
          if (res.ok) {
            const data: Workspace[] = await res.json();
            setWorkspaces(data);
            if (data.length > 0) {
              const savedId = typeof window !== "undefined"
                ? localStorage.getItem("current-workspace-id")
                : null;
              const target = savedId ? data.find((w) => w.id === savedId) : null;
              targetId = target ? target.id : data[0].id;
              setCurrentWorkspace(targetId);
            }
          }
        } catch {
          // ignore
        }
      }

      if (targetId) {
        router.replace(`/${targetId}/plugins`);
      } else {
        router.replace("/chat");
      }
    }

    loadAndRedirect();
  }, [router, currentWorkspaceId, setWorkspaces, setCurrentWorkspace]);

  return (
    <div className="flex-1 flex items-center justify-center h-full bg-background">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">正在跳转插件页面...</p>
      </div>
    </div>
  );
}
