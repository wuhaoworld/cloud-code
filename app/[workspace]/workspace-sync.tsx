"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/app-store";
import type { Workspace, Project, ProjectSession } from "@/store/app-store";

interface WorkspaceSyncProps {
  workspaceId: string;
  initialWorkspaces: Workspace[];
  initialProjects: Project[];
  initialSessions: Record<string, ProjectSession[]>;
}

export function WorkspaceSync({
  workspaceId,
  initialWorkspaces,
  initialProjects,
  initialSessions,
}: WorkspaceSyncProps) {
  const setCurrentWorkspace = useAppStore((state) => state.setCurrentWorkspace);
  const setWorkspaces = useAppStore((state) => state.setWorkspaces);
  const setProjects = useAppStore((state) => state.setProjects);
  const setSessions = useAppStore((state) => state.setSessions);
  const workspaces = useAppStore((state) => state.workspaces);

  // 注入服务端预取数据（仅在首次 mount 时初始化，避免覆盖用户操作后的状态）
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // 仅在 store 为空时才注入（避免路由切换时覆盖已有数据）
    if (workspaces.length === 0) {
      setWorkspaces(initialWorkspaces);
    }
    setProjects(initialProjects);
    Object.entries(initialSessions).forEach(([projectId, sessions]) => {
      setSessions(projectId, sessions);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 同步当前 workspace ID 到 store（路由切换时更新）
  useEffect(() => {
    if (workspaceId) {
      setCurrentWorkspace(workspaceId);
    }
  }, [workspaceId, setCurrentWorkspace]);

  return null;
}
