"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Streamdown } from "streamdown";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import type { ChatMessage } from "@/store/app-store";
import { code } from '@streamdown/code';
import { cjk } from '@streamdown/cjk';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(message.isStreaming ?? false);
  const [prevIsStreaming, setPrevIsStreaming] = useState(message.isStreaming);

  if (message.isStreaming !== prevIsStreaming) {
    setPrevIsStreaming(message.isStreaming);
    if (message.isStreaming) {
      setThinkingExpanded(true);
    }
  }

  useEffect(() => {
    if (!message.isStreaming) {
      const timer = setTimeout(() => {
        setThinkingExpanded(false);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [message.isStreaming]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!message.isStreaming) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [message.isStreaming]);

  const thinkingDuration = (() => {
    if (!message.thinkingStartedAt) return null;
    const endTime = message.isStreaming ? now : (message.timestamp || now);
    return Math.max(1, Math.round((endTime - message.thinkingStartedAt) / 1000));
  })();

  if (message.type === "thinking") {
    const hasContent = message.content && message.content.trim() !== "";

    // 无思考内容时，仅显示"思考中"动画
    if (!hasContent) {
      return (
        <div className="flex mb-4">
          <div className="flex-1">
            <span className="text-xs thinking-highlight font-medium">思考中</span>
          </div>
        </div>
      );
    }

    const label =
      !message.isStreaming
        ? `已思考 ${thinkingDuration ?? 1} 秒`
        : "思考中";

    return (
      <div className="flex mb-4">
        <div className="flex-1">
          <button
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
            className="flex items-center gap-1 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span
              className={cn(
                "text-xs",
                message.isStreaming ? "thinking-highlight font-medium" : ""
              )}
            >
              {label}
            </span>
            {thinkingExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
          {thinkingExpanded && (
            <div className="ml-0.5 my-2 pl-2 border-l-2 border-muted-foreground/15">
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {message.content}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.type === "tool_call" && message.toolCall) {
    return (
      <div className="flex mb-3">
        <div className="flex-1 min-w-0">
          <ToolCallCard toolCall={message.toolCall} />
        </div>
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex mb-4 justify-end">
        <div className="max-w-[80%]">
          <div
            className={cn(
              "rounded-2xl rounded-tr-sm px-4 py-2.5",
              "bg-muted",
              "text-foreground text-sm leading-relaxed whitespace-pre-wrap"
            )}
          >
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // AI 文本回复
  return (
    <div className="flex mb-4">
      <div className="flex-1 min-w-0">
        <Streamdown
          mode={message.isStreaming ? "streaming" : "static"}
          className="text-sm leading-relaxed text-foreground"
          plugins={{ code, cjk }}
          animated
          linkSafety={{ enabled: false }}
          controls={{ table: false }}
        >
          {message.content}
        </Streamdown>
      </div>
    </div>
  );
}
