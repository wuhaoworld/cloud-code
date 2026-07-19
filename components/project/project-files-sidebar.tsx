"use client";

import { useEffect, useState } from "react";
import { useAppStore, type ProjectFileNode } from "@/store/app-store";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";

function FileTreeNode({ node, depth }: { node: ProjectFileNode; depth: number }) {
  const hasChildren = node.type === "directory" && (node.children?.length ?? 0) > 0;
  const [expanded, setExpanded] = useState(true);
  const Icon = node.type === "directory"
    ? expanded ? FolderOpen : Folder
    : FileText;

  return (
    <li>
      <button
        type="button"
        onClick={() => hasChildren && setExpanded((value) => !value)}
        className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1 rounded-sm py-1 pr-2 text-left text-sm hover:bg-muted"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        aria-expanded={hasChildren ? expanded : undefined}
        title={node.path}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />
        ) : <span className="size-3 shrink-0" />}
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </button>
      {hasChildren && expanded && (
        <ul>{node.children!.map((child) => <FileTreeNode key={child.path} node={child} depth={depth + 1} />)}</ul>
      )}
    </li>
  );
}

export function ProjectFilesSidebar({ projectId }: { projectId: string }) {
  const cacheEntry = useAppStore((s) => s.projectFilesById[projectId]);
  const ensureProjectFiles = useAppStore((s) => s.ensureProjectFiles);
  const tree = cacheEntry?.tree ?? [];
  const isLoading = !cacheEntry || cacheEntry.status === "loading";
  const hasError = cacheEntry?.status === "error";

  useEffect(() => {
    void ensureProjectFiles(projectId);
  }, [cacheEntry, ensureProjectFiles, projectId]);

  return (
    <aside className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center border-b border-border/60 px-3 pr-12 text-sm font-medium">项目文件</div>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 正在加载文件...
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
          {hasError ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">无法加载项目文件</p>
          ) : tree.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">项目中没有可显示的文件</p>
          ) : (
            <ul>{tree.map((node) => <FileTreeNode key={node.path} node={node} depth={0} />)}</ul>
          )}
        </div>
      )}
    </aside>
  );
}
