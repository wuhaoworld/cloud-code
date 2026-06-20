"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import type { ChatMessage } from "@/store/app-store";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  if (message.type === "thinking") {
    return (
      <div className="flex mb-4">
        <div
          className={cn(
            "flex-1 rounded-xl overflow-hidden",
            "bg-gradient-to-br from-violet-50/80 to-purple-50/80",
            "border border-violet-200/60",
            "backdrop-blur-sm"
          )}
        >
          <button
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
            className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-violet-100/40 transition-colors"
          >
            <span className="text-xs font-medium text-violet-700">
              推理思考过程
            </span>
            <div className="flex-1" />
            {thinkingExpanded ? (
              <ChevronDown className="size-3.5 text-violet-500" />
            ) : (
              <ChevronRight className="size-3.5 text-violet-500" />
            )}
          </button>
          {thinkingExpanded && (
            <div className="px-4 pb-3 border-t border-violet-200/40">
              <p className="text-xs text-violet-800/80 leading-relaxed whitespace-pre-wrap mt-2">
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
        <div className="flex-1">
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
        <div
          className={cn(
            "text-sm leading-relaxed text-foreground",
            "prose prose-sm max-w-none",
            "prose-pre:bg-muted prose-pre:rounded-lg prose-pre:p-3",
            "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded",
            message.isStreaming && "after:content-['▋'] after:animate-pulse after:text-primary"
          )}
        >
          <MarkdownContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

// 简单 Markdown 渲染（代码块、行内代码）
function MarkdownContent({ content }: { content: string }) {
  // 将内容按代码块分割渲染
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const lines = part.slice(3).split("\n");
          const lang = lines[0] || "";
          const code = lines
            .slice(1)
            .join("\n")
            .replace(/```$/, "")
            .trimEnd();
          return (
            <div key={i} className="relative group">
              {lang && (
                <div className="absolute top-2 right-3 text-xs text-muted-foreground font-mono">
                  {lang}
                </div>
              )}
              <pre className="bg-muted/70 rounded-lg px-4 py-3 overflow-x-auto text-xs font-mono leading-relaxed">
                <code>{code}</code>
              </pre>
            </div>
          );
        }
        // 处理行内代码
        const inlineParts = part.split(/(`[^`]+`)/g);
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {inlineParts.map((inline, j) => {
              if (inline.startsWith("`") && inline.endsWith("`")) {
                return (
                  <code
                    key={j}
                    className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono"
                  >
                    {inline.slice(1, -1)}
                  </code>
                );
              }
              return <span key={j}>{inline}</span>;
            })}
          </p>
        );
      })}
    </div>
  );
}
