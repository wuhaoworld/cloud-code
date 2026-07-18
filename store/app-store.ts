import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Message, Block, TextBlock, ThinkingBlock, ToolUseBlock, StreamEvent, MessageStatus } from "./types";

export interface Workspace {
  id: string;
  name: string;
  userId: string;
  sandboxId?: string | null;
  sandboxSnapshotId?: string | null;
  sandboxStatus: "idle" | "starting" | "running" | "snapshotting";
  createdAt: number;
  updatedAt: number;
}

export type { Message, Block, TextBlock, ThinkingBlock, ToolUseBlock, StreamEvent, MessageStatus };

export interface Project {
  id: string;
  name: string;
  path: string;
  defaultModel?: string | null;
  workspaceId?: string | null;
  userId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSession {
  sessionId: string;
  projectId: string;
  title: string;
  gitBranch?: string | null;
  pinnedAt?: number | null;
  lastActiveAt: number;
  createdAt: number;
}

export interface PermissionRequest {
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}

// ---- 纯函数工具 ----

function normalizeMessages(messages: Message[]): Pick<AppState, "messageIds" | "messagesById"> {
  return {
    messageIds: messages.map((message) => message.id),
    messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
  };
}

function patchLastBlock<T extends Block>(
  blocks: Block[],
  guard: (b: Block) => b is T,
  fn: (b: T) => T
): Block[] {
  const last = blocks[blocks.length - 1];
  if (!last || !guard(last)) return blocks;
  return [...blocks.slice(0, -1), fn(last)];
}

// ---- Store ----

interface AppState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;

  projects: Project[];
  expandedProjects: Set<string>;
  currentProjectId: string | null;

  sessions: Record<string, ProjectSession[]>;
  currentSessionId: string | null;

  messageIds: string[];
  messagesById: Record<string, Message>;
  isStreaming: boolean;

  pendingPermission: PermissionRequest | null;

  sidebarWidth: number;
  rightPanelOpen: boolean;

  // Actions — Workspace
  setWorkspaces: (workspaces: Workspace[]) => void;
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (workspaceId: string) => void;
  setCurrentWorkspace: (workspaceId: string | null) => void;
  updateWorkspace: (workspaceId: string, data: Partial<Workspace>) => void;

  // Actions — 项目
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, data: Partial<Project>) => void;
  removeProject: (id: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
  setExpandedProjects: (projectIds: string[]) => void;
  setCurrentProject: (projectId: string | null) => void;

  // Actions — 会话
  setSessions: (projectId: string, sessions: ProjectSession[]) => void;
  addSession: (session: ProjectSession) => void;
  replaceSession: (projectId: string, sessionId: string, session: ProjectSession) => void;
  updateSession: (projectId: string, sessionId: string, data: Partial<ProjectSession>) => void;
  removeSession: (projectId: string, sessionId: string) => void;
  setCurrentSession: (sessionId: string | null) => void;

  // Actions — 消息
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  clearMessages: () => void;
  setIsStreaming: (streaming: boolean) => void;

  // 细粒度流式事件分发（核心改进）
  applyStreamEvent: (event: StreamEvent) => void;

  // Actions — 权限
  setPendingPermission: (permission: PermissionRequest | null) => void;

  // Actions — UI
  setSidebarWidth: (width: number) => void;
  setRightPanelOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    (set) => ({
      workspaces: [],
      currentWorkspaceId: null,

      projects: [],
      expandedProjects: new Set(),
      currentProjectId: null,
      sessions: {},
      currentSessionId: null,
      messageIds: [],
      messagesById: {},
      isStreaming: false,
      pendingPermission: null,
      sidebarWidth: 240,
      rightPanelOpen: false,

      // Workspace actions
      setWorkspaces: (workspaces) => set({ workspaces }),
      addWorkspace: (workspace) =>
        set((state) => ({ workspaces: [...state.workspaces, workspace] })),
      removeWorkspace: (workspaceId) =>
        set((state) => {
          const remaining = state.workspaces.filter((w) => w.id !== workspaceId);
          // Remove projects belonging to this workspace from local state
          const filteredProjects = state.projects.filter((p) => p.workspaceId !== workspaceId);
          const newCurrentWorkspaceId =
            state.currentWorkspaceId === workspaceId
              ? (remaining[0]?.id ?? null)
              : state.currentWorkspaceId;
          if (typeof window !== "undefined" && newCurrentWorkspaceId) {
            localStorage.setItem("current-workspace-id", newCurrentWorkspaceId);
          }
          return {
            workspaces: remaining,
            currentWorkspaceId: newCurrentWorkspaceId,
            projects: filteredProjects,
          };
        }),
      updateWorkspace: (workspaceId, data) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === workspaceId ? { ...w, ...data } : w
          ),
        })),
      setCurrentWorkspace: (workspaceId) => {
        if (typeof window !== "undefined" && workspaceId) {
          localStorage.setItem("current-workspace-id", workspaceId);
        }
        set((state) => {
          if (state.currentWorkspaceId === workspaceId) return {};
          return {
            currentWorkspaceId: workspaceId,
            projects: [],
            sessions: {},
            currentProjectId: null,
            currentSessionId: null,
          };
        });
      },

      // Project actions
      setProjects: (projects) => set({ projects }),
      addProject: (project) =>
        set((state) => ({ projects: [project, ...state.projects] })),
      updateProject: (id, data) =>
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? { ...p, ...data } : p)),
        })),
      removeProject: (id) =>
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
        })),
      toggleProjectExpanded: (projectId) =>
        set((state) => {
          const next = new Set(state.expandedProjects);
          if (next.has(projectId)) { next.delete(projectId); } else { next.add(projectId); }
          if (typeof window !== "undefined") {
            localStorage.setItem("expanded-projects", JSON.stringify(Array.from(next)));
          }
          return { expandedProjects: next };
        }),
      setExpandedProjects: (projectIds) => {
        if (typeof window !== "undefined") {
          localStorage.setItem("expanded-projects", JSON.stringify(projectIds));
        }
        set({ expandedProjects: new Set(projectIds) });
      },
      setCurrentProject: (projectId) =>
        set((state) => {
          if (state.currentProjectId === projectId) return state;
          return {
            currentProjectId: projectId,
            currentSessionId: null,
            messageIds: [],
            messagesById: {},
            isStreaming: false,
          };
        }),

      // Session actions
      setSessions: (projectId, sessions) =>
        set((state) => {
          const pendingSessions = (state.sessions[projectId] || []).filter((session) =>
            session.sessionId.startsWith("pending-")
          );
          return {
            sessions: {
              ...state.sessions,
              [projectId]: [...pendingSessions, ...sessions],
            },
          };
        }),
      addSession: (session) =>
        set((state) => {
          const existing = state.sessions[session.projectId] || [];
          if (existing.some((s) => s.sessionId === session.sessionId)) {
            return state;
          }
          return {
            sessions: {
              ...state.sessions,
              [session.projectId]: [session, ...existing],
            },
          };
        }),
      replaceSession: (projectId, sessionId, session) =>
        set((state) => {
          const existing = state.sessions[projectId] || [];
          const withoutOld = existing.filter((s) => s.sessionId !== sessionId);
          const hasNew = withoutOld.some((s) => s.sessionId === session.sessionId);
          return {
            sessions: {
              ...state.sessions,
              [projectId]: hasNew ? withoutOld : [session, ...withoutOld],
            },
            currentSessionId:
              state.currentSessionId === sessionId
                ? session.sessionId
                : state.currentSessionId,
          };
        }),
      updateSession: (projectId, sessionId, data) =>
        set((state) => {
          const existing = state.sessions[projectId] || [];
          return {
            sessions: {
              ...state.sessions,
              [projectId]: existing.map((s) =>
                s.sessionId === sessionId ? { ...s, ...data } : s
              ),
            },
          };
        }),
      removeSession: (projectId, sessionId) =>
        set((state) => {
          const existing = state.sessions[projectId] || [];
          return {
            sessions: {
              ...state.sessions,
              [projectId]: existing.filter((s) => s.sessionId !== sessionId),
            },
            currentSessionId:
              state.currentSessionId === sessionId
                ? null
                : state.currentSessionId,
          };
        }),
      setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

      // Message actions
      setMessages: (messages) => set(normalizeMessages(messages)),
      addMessage: (message) =>
        set((state) => {
          const exists = Boolean(state.messagesById[message.id]);
          state.messagesById[message.id] = message;
          return {
            messageIds: exists ? state.messageIds : [...state.messageIds, message.id],
            messagesById: state.messagesById,
          };
        }),
      clearMessages: () => set({ messageIds: [], messagesById: {} }),
      setIsStreaming: (isStreaming) => set({ isStreaming }),

      // ---- 核心：细粒度流式事件分发 ----
      applyStreamEvent: (event: StreamEvent) => {
        const patchMessage = (id: string, patch: (message: Message) => Message) => {
          set((state) => {
            const message = state.messagesById[id];
            if (!message) return state;
            state.messagesById[id] = patch(message);
            return { messagesById: state.messagesById };
          });
        };

        switch (event.type) {
          case "text_delta": {
            patchMessage(event.msgId, (msg) => {
              const last = msg.blocks[msg.blocks.length - 1];
              if (!last || last.type !== "text") {
                return {
                  ...msg,
                  blocks: [...msg.blocks, { type: "text" as const, text: event.delta }],
                  status: "streaming" as MessageStatus,
                };
              }
              return {
                ...msg,
                blocks: patchLastBlock(
                  msg.blocks,
                  (b): b is TextBlock => b.type === "text",
                  (b) => ({ ...b, text: b.text + event.delta })
                ),
                status: "streaming" as MessageStatus,
              };
            });
            break;
          }

          case "thinking_delta": {
            patchMessage(event.msgId, (msg) => {
              const last = msg.blocks[msg.blocks.length - 1];
              if (!last || last.type !== "thinking") {
                return {
                  ...msg,
                  blocks: [...msg.blocks, { type: "thinking" as const, text: event.delta }],
                  status: "streaming" as MessageStatus,
                };
              }
              return {
                ...msg,
                blocks: patchLastBlock(
                  msg.blocks,
                  (b): b is ThinkingBlock => b.type === "thinking",
                  (b) => ({ ...b, text: b.text + event.delta })
                ),
                status: "streaming" as MessageStatus,
              };
            });
            break;
          }

          case "thinking_done": {
            patchMessage(event.msgId, (msg) => ({
              ...msg,
              blocks: msg.blocks.map((b) =>
                b.type === "thinking" && b.durationSeconds === undefined
                  ? { ...b, durationSeconds: event.durationSeconds }
                  : b
              ),
            }));
            break;
          }

          case "tool_start": {
            const newToolBlock: ToolUseBlock = {
              type: "tool_use",
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              input: event.input,
              status: "running",
            };
            patchMessage(event.msgId, (msg) => ({
              ...msg,
              blocks: [...msg.blocks, newToolBlock],
              status: "streaming" as MessageStatus,
            }));
            break;
          }

          case "tool_end": {
            patchMessage(event.msgId, (msg) => ({
              ...msg,
              blocks: msg.blocks.map((b) =>
                b.type === "tool_use" && b.toolUseId === event.toolUseId
                  ? {
                      ...b,
                      output: event.output,
                      isError: event.isError,
                      status: (event.isError ? "error" : "done") as ToolUseBlock["status"],
                      durationMs: event.durationMs,
                    }
                  : b
              ),
            }));
            break;
          }

          case "permission_request":
            set({
              pendingPermission: {
                requestId: event.requestId,
                toolUseId: event.toolUseId,
                toolName: event.toolName,
                input: event.input,
              },
            });
            break;

          case "permission_resolved":
            set({ pendingPermission: null });
            break;

          case "done": {
            set((state) => ({
              messagesById: Object.fromEntries(
                Object.entries(state.messagesById).map(([id, message]) => [
                  id,
                  message.status === "streaming"
                    ? { ...message, status: "done" as MessageStatus }
                    : message,
                ])
              ),
              isStreaming: false,
            }));
            break;
          }

          case "error": {
            set((state) => ({
              messagesById: Object.fromEntries(
                Object.entries(state.messagesById).map(([id, message]) => [
                  id,
                  message.status === "streaming"
                    ? { ...message, status: "error" as MessageStatus }
                    : message,
                ])
              ),
              isStreaming: false,
            }));
            break;
          }

          default:
            break;
        }
      },

      // Permission actions
      setPendingPermission: (pendingPermission) => set({ pendingPermission }),

      // UI actions
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
    }),
    { name: "app-store" }
  )
);
