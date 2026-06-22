"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, CornerDownLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PermissionRequest } from "@/store/app-store";

interface PermissionDialogProps {
  permission: PermissionRequest | null;
  onApprove: (requestId: string, remember?: boolean) => void;
  onDeny: (requestId: string) => void;
}

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  /sudo/,
  /chmod\s+777/,
  />\s*\/dev\//,
  /dd\s+if=/,
];

function isDangerous(input: Record<string, unknown>): boolean {
  const command = String(input.command || "");
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

function getPermissionSummary(permission: PermissionRequest) {
  const command = permission.input.command;
  if (typeof command === "string" && command.trim()) {
    return command.trim();
  }

  return JSON.stringify(permission.input, null, 2);
}

function getCommandPrefix(summary: string) {
  return summary.trim().split(/\s+/)[0] || "该命令";
}

export function PermissionDialog({
  permission,
  onApprove,
  onDeny,
}: PermissionDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!permission) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => (current + 1) % 3);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => (current + 2) % 3);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (selectedIndex === 0) onApprove(permission.requestId);
        if (selectedIndex === 1) onApprove(permission.requestId, true);
        if (selectedIndex === 2) onDeny(permission.requestId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onApprove, onDeny, permission, selectedIndex]);

  if (!permission) return null;

  const dangerous = isDangerous(permission.input);
  const summary = getPermissionSummary(permission);
  const prefix = getCommandPrefix(summary);
  const title = dangerous
    ? "是否允许我运行一个高风险命令？"
    : "是否允许我运行这个命令？";

  return (
    <section
      aria-live="polite"
      aria-label="权限请求"
      className={cn(
        "overflow-hidden rounded-[22px] border bg-background/98 shadow-[0_18px_60px_rgba(15,23,42,0.10)] backdrop-blur",
        "dark:bg-[#161512]/98 dark:shadow-[0_18px_60px_rgba(0,0,0,0.36)]",
        dangerous ? "border-red-500/35" : "border-border/80",
      )}
      id="permission-inline-card"
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
              dangerous
                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {dangerous ? <AlertTriangle className="size-4" /> : <Shield className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-6 text-foreground sm:text-base">
              {title}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              工具：<span className="font-mono">{permission.toolName}</span>
            </p>
          </div>
        </div>

        <pre
          className={cn(
            "mt-4 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl px-3 py-2.5 font-mono text-[13px] leading-6",
            dangerous
              ? "border border-red-500/20 bg-red-500/[0.06] text-red-700 dark:text-red-300"
              : "bg-muted/55 text-muted-foreground",
          )}
        >
          {summary}
        </pre>

        <div className="mt-3 space-y-1">
          <button
            type="button"
            onClick={() => onApprove(permission.requestId)}
            onMouseEnter={() => setSelectedIndex(0)}
            data-selected={selectedIndex === 0}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition-colors",
              selectedIndex === 0
                ? dangerous
                  ? "bg-red-600 text-white"
                  : "bg-muted text-foreground"
                : dangerous
                  ? "text-red-700 hover:bg-red-500/10 dark:text-red-300"
                  : "text-foreground hover:bg-muted/70",
            )}
            id="permission-approve-btn"
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                selectedIndex === 0
                  ? dangerous
                    ? "bg-white text-red-600"
                    : "bg-foreground text-background"
                  : "border bg-background text-muted-foreground",
              )}
            >
              1
            </span>
            <span className="font-semibold">是</span>
            <Check className="ml-auto size-4 opacity-60" />
          </button>

          <button
            type="button"
            onClick={() => onApprove(permission.requestId, true)}
            onMouseEnter={() => setSelectedIndex(1)}
            data-selected={selectedIndex === 1}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition-colors",
              selectedIndex === 1
                ? "bg-muted text-foreground"
                : "text-foreground hover:bg-muted/70",
            )}
            id="permission-approve-prefix-btn"
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                selectedIndex === 1
                  ? "bg-foreground text-background"
                  : "border bg-background text-muted-foreground",
              )}
            >
              2
            </span>
            <span className="font-semibold">
              是，且对于以后续内容开头的命令不再询问{" "}
              <span className="font-mono text-muted-foreground">{prefix}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => onDeny(permission.requestId)}
            onMouseEnter={() => setSelectedIndex(2)}
            data-selected={selectedIndex === 2}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition-colors",
              selectedIndex === 2
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
            id="permission-deny-btn"
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                selectedIndex === 2
                  ? "bg-foreground text-background"
                  : "border bg-background text-muted-foreground",
              )}
            >
              3
            </span>
            <span className="font-semibold">否</span>
          </button>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDeny(permission.requestId)}
            className="text-muted-foreground"
          >
            跳过
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onApprove(permission.requestId)}
            className={cn(
              "h-9 rounded-full px-4 text-sm font-semibold",
              dangerous && "bg-red-600 text-white hover:bg-red-700",
            )}
          >
            提交
            <CornerDownLeft className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
