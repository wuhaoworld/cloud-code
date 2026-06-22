"use client";

import { use, useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useAppStore } from "@/store/app-store";
import type { Message, Block } from "@/store/types";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ChatInput } from "@/components/chat/chat-input";
import { PermissionDialog } from "@/components/chat/permission-dialog";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { SessionActionsMenu } from "@/components/session-actions-menu";

interface ChatPageProps {
  params: Promise<{ projectId: string }>;
}

export default function ProjectChatPage({ params }: ChatPageProps) {
  const { projectId } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ChatArea projectId={projectId} sessionId={undefined} />
    </Suspense>
  );
}

// 将 DB 行还原为新的 Message/Block 格式
// 兼容新格式（type="blocks", toolCallJson=Block[]）和旧格式（type="tool_call", toolCallJson=ToolCall）
function rowToMessage(row: {
  id: string;
  role: "user" | "assistant";
  type: string;
  content: string;
  toolCallJson: string | null;
  sortOrder: number;
  createdAt: number;
}): Message {
  if (row.role === "user") {
    return {
      id: row.id,
      role: "user",
      blocks: [{ type: "text", text: row.content }],
      status: "done",
      createdAt: row.createdAt,
    };
  }

  // 新格式：toolCallJson 存的是 Block[]
  if (row.type === "blocks" && row.toolCallJson) {
    try {
      const blocks: Block[] = JSON.parse(row.toolCallJson);
      return {
        id: row.id,
        role: "assistant",
        blocks,
        status: "done",
        createdAt: row.createdAt,
      };
    } catch {
      // fallthrough
    }
  }

  // 旧格式兼容：text / thinking / tool_call
  if (row.type === "thinking") {
    return {
      id: row.id,
      role: "assistant",
      blocks: [{ type: "thinking", text: row.content }],
      status: "done",
      createdAt: row.createdAt,
    };
  }

  if (row.type === "tool_call" && row.toolCallJson) {
    try {
      const tc = JSON.parse(row.toolCallJson) as {
        toolName: string;
        input: Record<string, unknown>;
        result?: string;
        status?: string;
        duration?: number;
      };
      return {
        id: row.id,
        role: "assistant",
        blocks: [
          {
            type: "tool_use",
            toolUseId: row.id,
            toolName: tc.toolName,
            input: tc.input,
            output: tc.result,
            status: (tc.status as "done" | "error" | "running") ?? "done",
            durationMs: tc.duration,
          },
        ],
        status: "done",
        createdAt: row.createdAt,
      };
    } catch {
      // fallthrough
    }
  }

  // 默认：文本消息
  return {
    id: row.id,
    role: "assistant",
    blocks: [{ type: "text", text: row.content }],
    status: "done",
    createdAt: row.createdAt,
  };
}

export function ChatArea({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId?: string;
}) {
  const {
    projects,
    sessions,
    currentSessionId,
    messages,
    isStreaming,
    pendingPermission,
    setMessages,
    setPendingPermission,
    setCurrentProject,
    setCurrentSession,
    clearMessages,
    addSession,
  } = useAppStore();

  const { send, interrupt } = useAgentStream();

  const bottomRef = useRef<HTMLDivElement>(null);
  const currentProject = projects.find((p) => p.id === projectId);
  const currentSession = (sessions[projectId] || []).find(
    (s) => s.sessionId === currentSessionId
  );

  const loadedKeyRef = useRef<string>("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const searchParams = useSearchParams();
  const promptParam = searchParams.get("prompt");
  const initialSentRef = useRef(false);

  // 切换会话/项目时初始化 & 加载历史消息（合并为单个 effect，避免 setCurrentProject 清除流式消息）
  useEffect(() => {
    const key = `${projectId}:${sessionId ?? "new"}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;

    setCurrentProject(projectId);
    if (sessionId) setCurrentSession(sessionId);

    if (!sessionId) {
      // 如果有来自 welcome 页的 prompt，不要清除消息——handleSend 会添加用户/助手消息
      if (!promptParam) {
        clearMessages();
      }
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingHistory(true);
    fetch(`/api/projects/${projectId}/sessions/${sessionId}/messages`)
      .then((res) => {
        if (!res.ok) throw new Error("加载失败");
        return res.json();
      })
      .then(
        (
          rows: Array<{
            id: string;
            role: "user" | "assistant";
            type: string;
            content: string;
            toolCallJson: string | null;
            sortOrder: number;
            createdAt: number;
          }>
        ) => {
          setMessages(rows.map(rowToMessage));
        }
      )
      .catch(() => {
        toast.error("加载对话历史失败");
      })
      .finally(() => {
        setIsLoadingHistory(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sessionId, promptParam]);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(
    async (
      prompt: string,
      _attachments?: import("@/components/chat/chat-input/AttachmentCard").AttachmentFile[],
      _skillIds?: string[] | null
    ) => {
      if (isStreamingRef.current) return;

      await send({
        projectId,
        prompt,
        sessionId: currentSessionId ?? sessionId,
        onNewSession: (newSessionId) => {
          addSession({
            sessionId: newSessionId,
            projectId,
            title: prompt.slice(0, 50) + (prompt.length > 50 ? "..." : ""),
            lastActiveAt: Date.now(),
            createdAt: Date.now(),
          });
          window.history.replaceState(null, "", `/chat/${projectId}/${newSessionId}`);
          setCurrentSession(newSessionId);
          loadedKeyRef.current = `${projectId}:${newSessionId}`;
        },
      });
    },
    [projectId, sessionId, currentSessionId, send, addSession, setCurrentSession]
  );

  const handleStop = useCallback(() => {
    interrupt();
  }, [interrupt]);

  // 检测来自 welcome 页的初始 prompt
  useEffect(() => {
    if (
      promptParam &&
      !sessionId &&
      !initialSentRef.current &&
      projects.length > 0 &&
      !isLoadingHistory
    ) {
      initialSentRef.current = true;
      handleSend(promptParam);
      window.history.replaceState(null, "", `/chat/${projectId}`);
    }
  }, [promptParam, projectId, sessionId, projects, isLoadingHistory, handleSend]);

  const handleApprove = async (requestId: string) => {
    try {
      await fetch("/api/chat/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action: "approve" }),
      });
      setPendingPermission(null);
    } catch {
      toast.error("审批请求失败");
    }
  };

  const handleDeny = async (requestId: string) => {
    try {
      await fetch("/api/chat/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action: "deny" }),
      });
      setPendingPermission(null);
    } catch {
      toast.error("拒绝请求失败");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具栏 */}
      <header className="flex items-center gap-2 px-6 py-3 border-b border-border/60 shrink-0">
        <span className="text-sm text-foreground truncate">
          {currentProject?.name || "未选择项目"}
        </span>
        {currentSession && (
          <>
            <span className="text-border text-xs">/</span>
            <span className="text-sm text-foreground truncate">{currentSession.title}</span>
            <SessionActionsMenu
              projectId={projectId}
              sessionId={currentSession.sessionId}
              title={currentSession.title}
              pinnedAt={currentSession.pinnedAt}
            />
          </>
        )}
        {(isStreaming || isLoadingHistory) && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {isLoadingHistory ? "加载对话历史..." : "AI 正在思考..."}
          </div>
        )}
      </header>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {isLoadingHistory ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">正在加载对话历史...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">向 AI 发送消息开始对话</p>
            </div>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入区域 */}
      <div className="shrink-0 border-t border-border/60 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            disabled={!currentProject || isLoadingHistory}
            projectId={projectId}
          />
        </div>
      </div>

      {/* 权限审批弹窗 */}
      <PermissionDialog
        permission={pendingPermission}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />
    </div>
  );
}
