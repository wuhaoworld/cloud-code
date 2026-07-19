"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { CircleStop, Loader2, Play, Power, TerminalSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

type SandboxStatus = "idle" | "starting" | "running" | "snapshotting";
type TerminalEntryKind = "command" | "stdout" | "stderr" | "system" | "error";

type TerminalEntry = {
  id: string;
  kind: TerminalEntryKind;
  text: string;
};

type TerminalEvent =
  | { type: "started"; executionId: string; cwd: string }
  | { type: "stdout" | "stderr"; executionId: string; data: string }
  | { type: "exit"; executionId: string; exitCode: number | null; signal: string | null; durationMs: number }
  | { type: "error"; executionId?: string; message: string };

const statusLabel: Record<SandboxStatus, string> = {
  idle: "未启动",
  starting: "启动中",
  running: "运行中",
  snapshotting: "快照中",
};

function parseSseChunk(chunk: string): TerminalEvent | null {
  let type = "";
  let data = "";
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event: ")) type = line.slice(7).trim();
    if (line.startsWith("data: ")) data = line.slice(6);
  }
  if (!type || !data) return null;
  try {
    return { type, ...JSON.parse(data) } as TerminalEvent;
  } catch {
    return null;
  }
}

export function SandboxTerminal({
  workspaceId,
  projectId,
}: {
  workspaceId?: string | null;
  projectId: string;
}) {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const invalidateProjectFiles = useAppStore((s) => s.invalidateProjectFiles);

  const appendEntry = useCallback((kind: TerminalEntryKind, text: string) => {
    if (!text) return;
    setEntries((current) => {
      const last = current[current.length - 1];
      if (last?.kind === kind && (kind === "stdout" || kind === "stderr")) {
        return [...current.slice(0, -1), { ...last, text: `${last.text}${text}` }];
      }
      return [...current, { id: crypto.randomUUID(), kind, text }];
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null);
      return;
    }

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/sandbox`);
      if (!response.ok) throw new Error("Unable to load Sandbox status");
      const data = await response.json() as { sandboxStatus: SandboxStatus };
      setStatus(data.sandboxStatus);
    } catch {
      setStatus(null);
      appendEntry("error", "无法获取 Sandbox 状态。\n");
    }
  }, [appendEntry, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshStatus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestControllerRef.current?.abort();
    };
  }, [refreshStatus]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [entries]);

  const startSandbox = async () => {
    if (!workspaceId || isStarting) return;
    setIsStarting(true);
    appendEntry("system", "正在启动 Sandbox…\n");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Sandbox 启动失败");
      setStatus("running");
      appendEntry("system", "Sandbox 已启动。\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox 启动失败";
      appendEntry("error", `${message}\n`);
      toast.error(message);
      await refreshStatus();
    } finally {
      setIsStarting(false);
    }
  };

  const handleTerminalEvent = useCallback((event: TerminalEvent) => {
    switch (event.type) {
      case "started":
        setExecutionId(event.executionId);
        appendEntry("system", `在 ${event.cwd} 中执行…\n`);
        break;
      case "stdout":
        appendEntry("stdout", event.data);
        break;
      case "stderr":
        appendEntry("stderr", event.data);
        break;
      case "exit":
        appendEntry(
          "system",
          `\n进程已结束（退出码：${event.exitCode ?? "—"}${event.signal ? `，${event.signal}` : ""}，耗时 ${(event.durationMs / 1_000).toFixed(1)} 秒）。\n`,
        );
        break;
      case "error":
        appendEntry("error", `${event.message}\n`);
        break;
    }
  }, [appendEntry]);

  const runCommand = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedCommand = command.trim();
    if (!trimmedCommand || isExecuting || !workspaceId) return;

    setCommand("");
    setIsExecuting(true);
    setExecutionId(null);
    appendEntry("command", `$ ${trimmedCommand}\n`);

    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/sandbox/terminal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, command: trimmedCommand }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Sandbox 命令执行失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const terminalEvent = parseSseChunk(chunk);
          if (terminalEvent) handleTerminalEvent(terminalEvent);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        appendEntry("system", "已请求中止命令。\n");
      } else {
        const message = error instanceof Error ? error.message : "Sandbox 命令执行失败";
        appendEntry("error", `${message}\n`);
        toast.error(message);
      }
    } finally {
      invalidateProjectFiles(projectId);
      requestControllerRef.current = null;
      setExecutionId(null);
      setIsExecuting(false);
    }
  };
  const cancelCommand = async () => {
    requestControllerRef.current?.abort();
    if (!workspaceId || !executionId) return;

    try {
      await fetch(`/api/workspaces/${workspaceId}/sandbox/terminal/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, executionId }),
      });
    } catch {
      // The stream abort already requests cancellation server-side. The explicit
      // endpoint is a best-effort fallback for subprocesses that outlive it.
    }
  };

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" && !command && entries.length > 0) {
      const lastCommand = [...entries].reverse().find((entry) => entry.kind === "command");
      if (lastCommand) {
        event.preventDefault();
        setCommand(lastCommand.text.replace(/^\$ /, "").trim());
      }
    }
  };

  const unavailable = !workspaceId;
  const canRun = status === "running" && !isExecuting && !unavailable;

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-700 px-3 text-xs">
        <TerminalSquare className="size-3.5 text-zinc-300" />
        <span className="font-medium">Sandbox 终端</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px]",
            status === "running"
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-zinc-700 text-zinc-300",
          )}
        >
          {unavailable ? "不可用" : status ? statusLabel[status] : "正在检查"}
        </span>
        <span className="min-w-0 truncate font-mono text-[11px] text-zinc-400">/workspace/项目目录</span>
        <div className="ml-auto flex items-center gap-1">
          {status !== "running" && !unavailable && (
            <button
              type="button"
              onClick={startSandbox}
              disabled={isStarting}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              {isStarting ? <Loader2 className="size-3 animate-spin" /> : <Power className="size-3" />}
              启动
            </button>
          )}
          {isExecuting && (
            <button
              type="button"
              onClick={cancelCommand}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-amber-200 hover:bg-zinc-800"
            >
              <CircleStop className="size-3" /> 中止
            </button>
          )}
          <button
            type="button"
            onClick={() => setEntries([])}
            className="rounded p-1 text-zinc-300 hover:bg-zinc-800"
            aria-label="清屏"
            title="清屏"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </header>

      <div ref={outputRef} className="flex-1 overflow-auto p-3 font-mono text-xs leading-5 scrollbar-thin">
        {entries.length === 0 ? (
          <p className="text-zinc-500">
            {unavailable
              ? "当前项目没有可用的 Sandbox。"
              : status === "running"
                ? "Sandbox 已就绪。输入命令开始执行。"
                : "启动 Sandbox 后可在当前项目目录中执行命令。"}
          </p>
        ) : (
          entries.map((entry) => (
            <pre
              key={entry.id}
              className={cn(
                "whitespace-pre-wrap break-words font-inherit",
                entry.kind === "command" && "text-sky-300",
                entry.kind === "stderr" && "text-amber-300",
                entry.kind === "error" && "text-red-300",
                entry.kind === "system" && "text-zinc-400",
              )}
            >
              {entry.text}
            </pre>
          ))
        )}
      </div>

      <form onSubmit={runCommand} className="flex shrink-0 items-center gap-2 border-t border-zinc-700 px-3 py-2">
        <span className="font-mono text-sm text-emerald-400">$</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={handleCommandKeyDown}
          disabled={!canRun}
          placeholder={status === "running" ? "输入要在 Sandbox 中执行的命令" : "请先启动 Sandbox"}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed"
          aria-label="Sandbox 命令"
        />
        <button
          type="submit"
          disabled={!canRun || !command.trim()}
          className="rounded p-1 text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="执行命令"
          title="执行命令"
        >
          {isExecuting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        </button>
      </form>
    </section>
  );
}
