"use client";

import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Search,
  Edit,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type { ToolCall } from "@/store/app-store";

interface ToolCallCardProps {
  toolCall: ToolCall;
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  Bash: Terminal,
  FileRead: FileText,
  FileWrite: Edit,
  FileEdit: Edit,
  Grep: Search,
  Glob: Search,
};

const TOOL_LABELS: Record<string, string> = {
  Bash: "终端命令",
  FileRead: "读取文件",
  FileWrite: "写入文件",
  FileEdit: "编辑文件",
  Grep: "搜索内容",
  Glob: "文件匹配",
};

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[toolCall.toolName] || Terminal;
  const label = TOOL_LABELS[toolCall.toolName] || toolCall.toolName;

  const statusIcon =
    toolCall.status === "running" ? (
      <Loader2 className="size-3 animate-spin text-blue-500" />
    ) : toolCall.status === "done" ? (
      <CheckCircle className="size-3 text-emerald-500" />
    ) : (
      <XCircle className="size-3 text-red-500" />
    );

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-muted/40 overflow-hidden text-xs",
        "transition-all duration-150"
      )}
    >
      {/* 标题行 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/60 transition-colors"
      >
        <Icon className="size-3.5 text-muted-foreground shrink-0" />
        <span
          className={cn(
            "font-medium transition-colors",
            toolCall.status === "running"
              ? "thinking-highlight"
              : "text-foreground"
          )}
        >
          {label}
        </span>

        {/* 命令预览 */}
        {toolCall.input?.command && (
          <code className="text-muted-foreground font-mono truncate flex-1 text-left">
            {String(toolCall.input.command as string).slice(0, 40)}
            {String(toolCall.input.command as string).length > 40 ? "…" : ""}
          </code>
        )}
        {toolCall.input?.file_path && (
          <code className="text-muted-foreground font-mono truncate flex-1 text-left">
            {String(toolCall.input.file_path as string).split("/").slice(-2).join("/")}
          </code>
        )}

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {toolCall.duration && (
            <span className="text-muted-foreground">
              {toolCall.duration}ms
            </span>
          )}
          {statusIcon}
          {expanded ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-border/60 px-3 py-2 space-y-2 overflow-hidden">
          {/* 输入参数 */}
          <div>
            <p className="text-muted-foreground mb-1">输入参数</p>
            <pre className="text-foreground font-mono bg-background/60 rounded p-2 overflow-x-auto text-[11px] leading-relaxed max-w-full whitespace-pre-wrap break-all">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>

          {/* 输出结果 */}
          {toolCall.result && (
            <div>
              <p className="text-muted-foreground mb-1">执行结果</p>
              <pre className="text-foreground font-mono bg-background/60 rounded p-2 overflow-x-auto text-[11px] leading-relaxed max-h-40 max-w-full whitespace-pre-wrap break-all">
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
