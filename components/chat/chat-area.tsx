"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";
import type { Message, Block } from "@/store/types";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ChatInput } from "@/components/chat/chat-input";
import type { PermissionMode } from "@/lib/permission-mode";
import { isPermissionMode } from "@/lib/permission-mode";
import { PermissionDialog } from "@/components/chat/permission-dialog";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { toast } from "sonner";
import { Loader2, PanelRight } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { SessionActionsMenu } from "@/components/session-actions-menu";
import { ProjectFilesSidebar } from "@/components/project/project-files-sidebar";
import { v4 as uuidv4 } from "uuid";

function MessageItem({ id, onUpdate }: { id: string; onUpdate: () => void }) {
  const message = useAppStore((state) => state.messagesById[id]);

  useEffect(() => {
    onUpdate();
  }, [message, onUpdate]);

  return message ? <MessageBubble message={message} /> : null;
}

function parsePermissionMode(value: string | null): PermissionMode | undefined {
  return isPermissionMode(value) ? value : undefined;
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
  const projects = useAppStore((state) => state.projects);
  const sessions = useAppStore((state) => state.sessions);
  const expandedProjects = useAppStore((state) => state.expandedProjects);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId);
  const messageIds = useAppStore((state) => state.messageIds);
  const isStreaming = useAppStore((state) => state.isStreaming);
  const pendingPermission = useAppStore((state) => state.pendingPermission);
  const setMessages = useAppStore((state) => state.setMessages);
  const setPendingPermission = useAppStore((state) => state.setPendingPermission);
  const setCurrentProject = useAppStore((state) => state.setCurrentProject);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const clearMessages = useAppStore((state) => state.clearMessages);
  const addSession = useAppStore((state) => state.addSession);
  const replaceSession = useAppStore((state) => state.replaceSession);
  const setExpandedProjects = useAppStore((state) => state.setExpandedProjects);

  const { send, interrupt } = useAgentStream();
  const router = useRouter();
  const routePrefix = currentWorkspaceId ? `/${currentWorkspaceId}/chat` : "/chat";

  const bottomRef = useRef<HTMLDivElement>(null);
  const currentProject = projects.find((p) => p.id === projectId);
  const currentSession = (sessions[projectId] || []).find(
    (s) => s.sessionId === currentSessionId
  );

  const loadedKeyRef = useRef<string>("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isFilesSidebarOpen, setIsFilesSidebarOpen] = useState(false);
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const searchParams = useSearchParams();
  const promptParam = searchParams.get("prompt");
  const permissionModeParam = parsePermissionMode(
    searchParams.get("permissionMode"),
  );
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

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleSend = useCallback(
    async (
      prompt: string,
      _attachments?: import("@/components/chat/chat-input/AttachmentCard").AttachmentFile[],
      _skillIds?: string[] | null,
      permissionMode?: PermissionMode,
      model?: string,
    ) => {
      if (isStreamingRef.current) return;

      const activeSessionId = currentSessionId ?? sessionId;
      const optimisticSessionId = activeSessionId ? undefined : `pending-${uuidv4()}`;
      const title = prompt.slice(0, 50) + (prompt.length > 50 ? "..." : "");
      const now = Date.now();

      if (optimisticSessionId) {
        if (!expandedProjects.has(projectId)) {
          setExpandedProjects([...Array.from(expandedProjects), projectId]);
        }
        addSession({
          sessionId: optimisticSessionId,
          projectId,
          title,
          lastActiveAt: now,
          createdAt: now,
        });
        setCurrentSession(optimisticSessionId);
      }

      await send({
        projectId,
        prompt,
        sessionId: activeSessionId,
        model,
        permissionMode,
        optimisticSessionId,
        onNewSession: (newSessionId, pendingSessionId) => {
          const session = {
            sessionId: newSessionId,
            projectId,
            title,
            lastActiveAt: Date.now(),
            createdAt: Date.now(),
          };
          if (pendingSessionId) {
            replaceSession(projectId, pendingSessionId, session);
          } else {
            addSession(session);
          }
          window.history.replaceState(null, "", `${routePrefix}/${projectId}/${newSessionId}`);
          setCurrentSession(newSessionId);
          loadedKeyRef.current = `${projectId}:${newSessionId}`;
        },
      });
    },
    [
      projectId,
      sessionId,
      currentSessionId,
      expandedProjects,
      send,
      addSession,
      replaceSession,
      setCurrentSession,
      setExpandedProjects,
      routePrefix,
    ]
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
      handleSend(promptParam, undefined, null, permissionModeParam);
      window.history.replaceState(null, "", `${routePrefix}/${projectId}`);
    }
  }, [
    promptParam,
    permissionModeParam,
    projectId,
    sessionId,
    projects,
    isLoadingHistory,
    handleSend,
    routePrefix,
  ]);

  const handleApprove = async (requestId: string, remember = false) => {
    try {
      await fetch("/api/chat/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          action: remember ? "approve_permanent" : "approve",
          workspaceId: currentProject?.workspaceId || undefined,
        }),
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
        body: JSON.stringify({
          requestId,
          action: "deny",
          workspaceId: currentProject?.workspaceId || undefined,
        }),
      });
      setPendingPermission(null);
    } catch {
      toast.error("拒绝请求失败");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部工具栏 */}
      <header className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-3">
        <button
          onClick={() => router.push(`${routePrefix}/${projectId}`)}
          className="truncate rounded-sm px-1.5 py-0.5 text-sm text-foreground transition-colors hover:bg-muted"
        >
          {currentProject?.name || "未选择项目"}
        </button>
        {currentSession && (
          <>
            <span className="text-xs text-border">/</span>
            <span className="ml-1 truncate text-sm text-foreground">{currentSession.title}</span>
            <SessionActionsMenu
              projectId={projectId}
              sessionId={currentSession.sessionId}
              title={currentSession.title}
              pinnedAt={currentSession.pinnedAt}
            />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsFilesSidebarOpen((open) => !open)}
            className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={isFilesSidebarOpen ? "隐藏项目文件侧边栏" : "显示项目文件侧边栏"}
            aria-pressed={isFilesSidebarOpen}
            title={isFilesSidebarOpen ? "隐藏项目文件" : "显示项目文件"}
          >
            <PanelRight className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="mx-auto max-w-3xl px-2 py-6">
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">正在加载对话历史...</p>
                </div>
              ) : messageIds.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">向 AI 发送消息开始对话</p>
                </div>
              ) : (
                messageIds.map((id) => (
                  <MessageItem key={id} id={id} onUpdate={scrollToBottom} />
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* 输入区域 */}
          <div className="shrink-0 border-t border-border/60 px-6 py-4">
            <div className="mx-auto max-w-3xl">
              {pendingPermission ? (
                <PermissionDialog
                  key={pendingPermission.requestId}
                  permission={pendingPermission}
                  onApprove={handleApprove}
                  onDeny={handleDeny}
                />
              ) : (
                <ChatInput
                  onSend={handleSend}
                  onStop={handleStop}
                  disabled={!currentProject || isLoadingHistory}
                  projectId={projectId}
                />
              )}
            </div>
          </div>
        </div>
        {isFilesSidebarOpen && (
          <ProjectFilesSidebar key={projectId} projectId={projectId} />
        )}
      </div>
    </div>
  );
}
