"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";

export function WorkspaceSync({ workspaceId }: { workspaceId: string }) {
  const { setCurrentWorkspace, workspaces, setWorkspaces } = useAppStore();

  // Sync workspace ID to application state store
  useEffect(() => {
    if (workspaceId) {
      setCurrentWorkspace(workspaceId);
    }
  }, [workspaceId, setCurrentWorkspace]);

  // Pre-load workspaces list if empty
  useEffect(() => {
    if (workspaces.length === 0) {
      fetch("/api/workspaces")
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((data) => {
          setWorkspaces(data);
        })
        .catch(() => {});
    }
  }, [workspaces.length, setWorkspaces]);

  return null;
}
