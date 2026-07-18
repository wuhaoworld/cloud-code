"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CornerDownLeft, Clock3, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { useAppStore } from "@/store/app-store";
import type { ProjectSession } from "@/store/app-store";

interface SearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResult {
  projectId: string;
  projectName: string;
  session: ProjectSession;
}

function formatSessionDate(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return "今天";
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "昨天";
  }

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function SearchPanel({ open, onOpenChange }: SearchPanelProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const projects = useAppStore((state) => state.projects);
  const sessions = useAppStore((state) => state.sessions);
  const setSessions = useAppStore((state) => state.setSessions);
  const setCurrentProject = useAppStore((state) => state.setCurrentProject);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const clearMessages = useAppStore((state) => state.clearMessages);

  useEffect(() => {
    if (!open) return;

    const missingProjects = projects.filter((project) => !sessions[project.id]);
    if (missingProjects.length === 0) return;

    const controller = new AbortController();

    void Promise.all(
      missingProjects.map(async (project) => {
        const response = await fetch(`/api/projects/${project.id}/sessions`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as ProjectSession[];
        setSessions(project.id, data);
      })
    ).catch(() => {});

    return () => controller.abort();
  }, [open, projects, sessions, setSessions]);

  useEffect(() => {
    if (!open) return;

    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, onOpenChange]);

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return projects
      .flatMap((project) =>
        (sessions[project.id] || []).map((session) => ({
          projectId: project.id,
          projectName: project.name,
          session,
        }))
      )
      .filter((result) => {
        if (!normalizedQuery) return true;
        return `${result.session.title} ${result.projectName}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => b.session.lastActiveAt - a.session.lastActiveAt)
      .slice(0, 8);
  }, [projects, query, sessions]);

  if (!open) return null;

  const selectedIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  const selectResult = (result: SearchResult) => {
    setCurrentProject(result.projectId);
    setCurrentSession(result.session.sessionId);
    clearMessages();
    onOpenChange(false);
    router.push(`/chat/${result.projectId}/${result.session.sessionId}`);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && results[selectedIndex]) {
      event.preventDefault();
      selectResult(results[selectedIndex]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[16vh]">
      <div
        ref={panelRef}
        className={cn(
          "w-[min(720px,calc(100vw-32px))] overflow-hidden rounded-2xl",
          "border border-black/10 bg-white/95 text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-xl",
          "animate-in fade-in-0 zoom-in-95 duration-150"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="搜索对话"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-black/5 px-5">
          <Search className="size-4 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
            placeholder="搜索对话..."
            aria-label="搜索对话"
          />
        </div>

        <div className="min-h-[240px] px-4 py-4">
          <div className="mb-2 flex items-center gap-1.5 px-1 text-xs text-zinc-400">
            <Clock3 className="size-3.5" />
            <span>近期对话</span>
          </div>

          {results.length > 0 ? (
            <div className="space-y-0.5">
              {results.map((result, index) => (
                <button
                  key={`${result.projectId}-${result.session.sessionId}`}
                  type="button"
                  onClick={() => selectResult(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors",
                    index === selectedIndex ? "bg-zinc-100" : "hover:bg-zinc-50"
                  )}
                >
                  <span className="truncate text-sm text-zinc-900">
                    {result.session.title}
                  </span>
                  <span className="hidden max-w-32 truncate text-xs text-zinc-400 sm:block">
                    {result.projectName}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {formatSessionDate(result.session.lastActiveAt)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-36 items-center justify-center rounded-xl text-sm text-zinc-400">
              {query.trim() ? "没有匹配的对话" : "暂无近期对话"}
            </div>
          )}
        </div>

        <div className="flex h-12 items-center gap-2 border-t border-black/5 px-5 text-xs text-zinc-400">
          <Kbd className="h-5 min-w-5 border border-black/10 bg-zinc-100 px-1 text-[11px] text-zinc-500 shadow-none">
            <ArrowUp className="size-3" />
          </Kbd>
          <Kbd className="h-5 min-w-5 border border-black/10 bg-zinc-100 px-1 text-[11px] text-zinc-500 shadow-none">
            <ArrowDown className="size-3" />
          </Kbd>
          <span>选择</span>
          <Kbd className="ml-3 h-5 min-w-5 border border-black/10 bg-zinc-100 px-1 text-[11px] text-zinc-500 shadow-none">
            <CornerDownLeft className="size-3" />
          </Kbd>
          <span>进入</span>
          <Kbd className="ml-3 h-5 border border-black/10 bg-zinc-100 px-1.5 text-[11px] text-zinc-500 shadow-none">
            Esc
          </Kbd>
          <span>关闭</span>
        </div>
      </div>
    </div>
  );
}
