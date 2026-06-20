"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Send, Square, Paperclip, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/store/app-store";

interface ChatInputProps {
  onSend: (prompt: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  onStop,
  disabled,
  placeholder = "向 AI 发送消息... (Shift+Enter 换行)",
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useAppStore((s) => s.isStreaming);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // 重置高度
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // 自动增高
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 输入区域 */}
      <div
        className={cn(
          "relative flex items-end gap-2 p-3 rounded-2xl",
          "bg-background border border-border/60",
          "shadow-sm",
          "focus-within:border-primary/50 focus-within:shadow-md focus-within:shadow-primary/5",
          "transition-all duration-200"
        )}
      >
        {/* 附件按钮 */}
        <button className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-0.5">
          <Paperclip className="size-4" />
        </button>

        {/* 文本框 */}
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className={cn(
            "flex-1 resize-none border-0 shadow-none focus-visible:ring-0 p-0",
            "text-sm leading-relaxed min-h-[24px] max-h-[200px]",
            "bg-transparent"
          )}
          disabled={disabled && !isStreaming}
          id="chat-input"
        />

        {/* 语音输入 */}
        <button className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-0.5">
          <Mic className="size-4" />
        </button>

        {/* 发送/停止按钮 */}
        {isStreaming ? (
          <Button
            size="icon"
            variant="outline"
            className="shrink-0 size-8 rounded-xl"
            onClick={onStop}
          >
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            className={cn(
              "shrink-0 size-8 rounded-xl",
              "bg-gradient-to-br from-blue-500 to-indigo-600",
              "hover:from-blue-600 hover:to-indigo-700",
              "disabled:opacity-40"
            )}
            disabled={!value.trim() || disabled}
            onClick={handleSend}
            id="chat-send-btn"
          >
            <Send className="size-3.5" />
          </Button>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] text-muted-foreground">
          按 Enter 发送，Shift+Enter 换行
        </p>
        <p className="text-[11px] text-muted-foreground">
          {value.length > 0 ? `${value.length} 字符` : ""}
        </p>
      </div>
    </div>
  );
}
