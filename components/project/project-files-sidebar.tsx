"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";

export type ProjectFileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: ProjectFileNode[];
};

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
        className="flex w-full items-center gap-1 rounded-sm py-1 pr-2 text-left text-sm hover:bg-muted"
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
  const [tree, setTree] = useState<ProjectFileNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/projects/${projectId}/files?tree=1`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load project files");
        return response.json() as Promise<{ tree?: ProjectFileNode[] }>;
      })
      .then((data) => {
        setTree(data.tree ?? []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHasError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [projectId]);

  return (
    <aside className="flex h-full min-w-0 flex-col bg-background">
      <div className="border-b border-border/60 px-3 py-3 pr-12 text-sm font-medium">项目文件</div>
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在加载文件...
          </div>
        ) : hasError ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">无法加载项目文件</p>
        ) : tree.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">项目中没有可显示的文件</p>
        ) : (
          <ul>{tree.map((node) => <FileTreeNode key={node.path} node={node} depth={0} />)}</ul>
        )}
      </div>
    </aside>
  );
}
