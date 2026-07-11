"use client";

import { use, Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatArea } from "@/app/chat/[projectId]/page";
import { useAppStore } from "@/store/app-store";
import { Loader2 } from "lucide-react";

interface SessionChatPageProps {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export default function SessionChatPage({ params }: SessionChatPageProps) {
  const { projectId, sessionId } = use(params);
  const router = useRouter();
  const { projects, setProjects } = useAppStore();
  const [loading, setLoading] = useState(true);

  // Pre-load projects if they aren't in the store yet
  useEffect(() => {
    if (projects.length === 0) {
      fetch("/api/projects")
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((data) => {
          setProjects(data);
        })
        .catch(() => {
          setTimeout(() => setLoading(false), 0);
        });
    }
  }, [projects.length, setProjects]);

  useEffect(() => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      if (project.workspaceId) {
        router.replace(`/${project.workspaceId}/chat/${projectId}/${sessionId}${window.location.search}`);
      } else {
        setTimeout(() => setLoading(false), 0);
      }
    } else if (projects.length > 0) {
      setTimeout(() => setLoading(false), 0);
    }
  }, [projects, projectId, sessionId, router]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">正在跳转会话...</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <ChatArea projectId={projectId} sessionId={sessionId} />
    </Suspense>
  );
}
