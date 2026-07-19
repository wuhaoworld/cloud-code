"use client";

import { useCallback, useRef } from "react";
import { useAppStore } from "@/store/app-store";
import type { StreamEvent } from "@/store/types";
import type { PermissionMode } from "@/lib/permission-mode";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";

export interface SendOptions {
  projectId: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  optimisticSessionId?: string;
  /** 发现新会话 ID 时的回调（新对话首条消息） */
  onNewSession?: (sessionId: string, optimisticSessionId?: string) => void;
}

function parseSSEChunk(chunk: string): { eventType: string; data: Record<string, unknown> } | null {
  const lines = chunk.split("\n");
  let eventType = "message";
  let dataLine = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice(6).trim();
    }
  }

  if (!dataLine) return null;
  try {
    return { eventType, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

function mayMutateProjectFiles(toolName: string): boolean {
  return /write|edit|bash|shell|delete|move|rename|copy|mkdir/i.test(toolName);
}

export function useAgentStream() {
  const applyStreamEvent = useAppStore((s) => s.applyStreamEvent);
  const addMessage = useAppStore((s) => s.addMessage);
  const setIsStreaming = useAppStore((s) => s.setIsStreaming);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const invalidateProjectFiles = useAppStore((s) => s.invalidateProjectFiles);

  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (opts: SendOptions) => {
      const {
        projectId,
        prompt,
        sessionId,
        model,
        permissionMode,
        optimisticSessionId,
        onNewSession,
      } = opts;
      let mayHaveChangedProjectFiles = false;

      const userMsgId = uuidv4();
      const assistantMsgId = uuidv4();

      // 乐观添加用户消息
      addMessage({
        id: userMsgId,
        role: "user",
        blocks: [{ type: "text", text: prompt }],
        status: "done",
        createdAt: Date.now(),
      });

      // 添加 assistant 占位消息（空 blocks，streaming 状态 → 显示加载动画）
      addMessage({
        id: assistantMsgId,
        role: "assistant",
        blocks: [],
        status: "streaming",
        createdAt: Date.now(),
      });

      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            prompt,
            sessionId,
            userMsgId,
            model,
            permissionMode,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          toast.error("请求失败，请检查项目配置");
          applyStreamEvent({ type: "error", message: "请求失败" });
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const parsed = parseSSEChunk(chunk);
            if (!parsed) continue;

            const { eventType, data } = parsed;

            // session_init：更新会话 ID（不走 applyStreamEvent）
            if (eventType === "session_init") {
              const newSessionId = data.sessionId as string;
              setCurrentSession(newSessionId);
              if (!sessionId && onNewSession) {
                onNewSession(newSessionId, optimisticSessionId);
              }
              continue;
            }

            // 所有其他事件统一走 store dispatcher
            // 将 data 的 msgId 强制覆盖为占位 assistantMsgId，因为 server 生成的 msgId 与
            // 客户端占位 id 不一致，需要对齐
            const streamEvent = {
              ...data,
              type: eventType,
              // 只有 assistant 类事件需要对齐 msgId
              ...(eventType !== "permission_request" &&
              eventType !== "permission_resolved" &&
              eventType !== "done" &&
              eventType !== "error"
                ? { msgId: assistantMsgId }
                : {}),
            } as StreamEvent;

            applyStreamEvent(streamEvent);

            if (streamEvent.type === "tool_start" && mayMutateProjectFiles(streamEvent.toolName)) {
              mayHaveChangedProjectFiles = true;
            }

            if (eventType === "error") {
              toast.error((data.message as string) || "AI 响应出错");
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toast.error("连接中断");
          applyStreamEvent({ type: "error", message: "连接中断" });
        } else {
          // 用户主动中断：将 streaming 消息标为 interrupted
          const { messagesById } = useAppStore.getState();
          useAppStore.setState({
            messagesById: Object.fromEntries(
              Object.entries(messagesById).map(([id, message]) => [
                id,
                message.status === "streaming"
                  ? { ...message, status: "interrupted" as const }
                  : message,
              ])
            ),
            isStreaming: false,
          });
        }
      } finally {
        if (mayHaveChangedProjectFiles) invalidateProjectFiles(projectId);
        abortRef.current = null;
      }
    },
    [
      applyStreamEvent,
      addMessage,
      setIsStreaming,
      setCurrentSession,
      invalidateProjectFiles,
    ]
  );

  const interrupt = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  return { send, interrupt };
}
