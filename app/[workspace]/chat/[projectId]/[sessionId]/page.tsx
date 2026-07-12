"use client";

import { use, Suspense } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { Loader2 } from "lucide-react";

interface WorkspaceSessionChatPageProps {
  params: Promise<{ workspace: string; projectId: string; sessionId: string }>;
}

export default function WorkspaceSessionChatPage({ params }: WorkspaceSessionChatPageProps) {
  const { projectId, sessionId } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ChatArea projectId={projectId} sessionId={sessionId} />
    </Suspense>
  );
}
