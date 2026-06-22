import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Message, Block, TextBlock, ThinkingBlock, ToolUseBlock, StreamEvent, MessageStatus } from "./types";

export type { Message, Block, TextBlock, ThinkingBlock, ToolUseBlock, StreamEvent, MessageStatus };

export interface Project {
  id: string;
  name: string;
  path: string;
  defaultModel?: string | null;
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

function patchMessage(msgs: Message[], id: string, fn: (m: Message) => Message): Message[] {
  return msgs.map((m) => (m.id === id ? fn(m) : m));
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
  projects: Project[];
  expandedProjects: Set<string>;
  currentProjectId: string | null;

  sessions: Record<string, ProjectSession[]>;
  currentSessionId: string | null;

  messages: Message[];
  isStreaming: boolean;

  pendingPermission: PermissionRequest | null;

  sidebarWidth: number;
  rightPanelOpen: boolean;

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
    (set, get) => ({
      projects: [],
      expandedProjects: new Set(),
      currentProjectId: null,
      sessions: {},
      currentSessionId: null,
      messages: [],
      isStreaming: false,
      pendingPermission: null,
      sidebarWidth: 240,
      rightPanelOpen: false,

      // Project actions
      setProjects: (projects) => set({ projects }),
      addProject: (project) =>
        set((state) => ({ projects: [...state.projects, project] })),
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
          return { currentProjectId: projectId, currentSessionId: null, messages: [], isStreaming: false };
        }),

      // Session actions
      setSessions: (projectId, sessions) =>
        set((state) => ({ sessions: { ...state.sessions, [projectId]: sessions } })),
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
      setMessages: (messages) => set({ messages }),
      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
      clearMessages: () => set({ messages: [] }),
      setIsStreaming: (isStreaming) => set({ isStreaming }),

      // ---- 核心：细粒度流式事件分发 ----
      applyStreamEvent: (event: StreamEvent) => {
        const { messages } = get();

        switch (event.type) {
          case "text_delta": {
            const updated = patchMessage(messages, event.msgId, (msg) => {
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
            set({ messages: updated });
            break;
          }

          case "thinking_delta": {
            const updated = patchMessage(messages, event.msgId, (msg) => {
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
            set({ messages: updated });
            break;
          }

          case "thinking_done": {
            const updated = patchMessage(messages, event.msgId, (msg) => ({
              ...msg,
              blocks: msg.blocks.map((b) =>
                b.type === "thinking" && b.durationSeconds === undefined
                  ? { ...b, durationSeconds: event.durationSeconds }
                  : b
              ),
            }));
            set({ messages: updated });
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
            const updated = patchMessage(messages, event.msgId, (msg) => ({
              ...msg,
              blocks: [...msg.blocks, newToolBlock],
              status: "streaming" as MessageStatus,
            }));
            set({ messages: updated });
            break;
          }

          case "tool_end": {
            const updated = patchMessage(messages, event.msgId, (msg) => ({
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
            set({ messages: updated });
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
            const updated = messages.map((m) =>
              m.status === "streaming" ? { ...m, status: "done" as MessageStatus } : m
            );
            set({ messages: updated, isStreaming: false });
            break;
          }

          case "error": {
            const updated = messages.map((m) =>
              m.status === "streaming" ? { ...m, status: "error" as MessageStatus } : m
            );
            set({ messages: updated, isStreaming: false });
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
