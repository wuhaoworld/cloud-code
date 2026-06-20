import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string | null;
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
  lastActiveAt: number;
  createdAt: number;
}

export type MessageRole = "user" | "assistant";
export type MessageType = "text" | "thinking" | "tool_call" | "tool_result" | "permission_request";

export interface ToolCall {
  toolName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  result?: string;
  status: "running" | "done" | "error";
  duration?: number;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  command?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  type: MessageType;
  content: string;
  toolCall?: ToolCall;
  permissionRequest?: PermissionRequest;
  isStreaming?: boolean;
  timestamp: number;
  thinkingStartedAt?: number;
}

interface AppState {
  // 项目状态
  projects: Project[];
  expandedProjects: Set<string>;
  currentProjectId: string | null;

  // 会话状态
  sessions: Record<string, ProjectSession[]>; // projectId -> sessions
  currentSessionId: string | null;

  // 消息状态
  messages: ChatMessage[];
  isStreaming: boolean;

  // 权限请求
  pendingPermission: PermissionRequest | null;

  // UI 状态
  sidebarWidth: number;
  rightPanelOpen: boolean;

  // Actions — 项目
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, data: Partial<Project>) => void;
  removeProject: (id: string) => void;
  toggleProjectExpanded: (projectId: string) => void;
  setCurrentProject: (projectId: string | null) => void;

  // Actions — 会话
  setSessions: (projectId: string, sessions: ProjectSession[]) => void;
  addSession: (session: ProjectSession) => void;
  setCurrentSession: (sessionId: string | null) => void;

  // Actions — 消息
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string, isStreaming?: boolean) => void;
  appendToLastMessage: (content: string) => void;
  clearMessages: () => void;
  setIsStreaming: (streaming: boolean) => void;

  // Actions — 权限
  setPendingPermission: (permission: PermissionRequest | null) => void;

  // Actions — UI
  setSidebarWidth: (width: number) => void;
  setRightPanelOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    (set, get) => ({
      // Initial state
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
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...data } : p
          ),
        })),
      removeProject: (id) =>
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          currentProjectId:
            state.currentProjectId === id ? null : state.currentProjectId,
        })),
      toggleProjectExpanded: (projectId) =>
        set((state) => {
          const next = new Set(state.expandedProjects);
          if (next.has(projectId)) {
            next.delete(projectId);
          } else {
            next.add(projectId);
          }
          return { expandedProjects: next };
        }),
      setCurrentProject: (projectId) =>
        set({ currentProjectId: projectId, currentSessionId: null, messages: [] }),

      // Session actions
      setSessions: (projectId, sessions) =>
        set((state) => ({
          sessions: { ...state.sessions, [projectId]: sessions },
        })),
      addSession: (session) =>
        set((state) => ({
          sessions: {
            ...state.sessions,
            [session.projectId]: [
              session,
              ...(state.sessions[session.projectId] || []),
            ],
          },
        })),
      setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

      // Message actions
      setMessages: (messages) => set({ messages }),
      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
      updateLastMessage: (content, isStreaming) =>
        set((state) => {
          const msgs = [...state.messages];
          if (msgs.length === 0) return {};
          const last = { ...msgs[msgs.length - 1], content };
          if (isStreaming !== undefined) last.isStreaming = isStreaming;
          msgs[msgs.length - 1] = last;
          return { messages: msgs };
        }),
      appendToLastMessage: (content) =>
        set((state) => {
          const msgs = [...state.messages];
          if (msgs.length === 0) return {};
          msgs[msgs.length - 1] = {
            ...msgs[msgs.length - 1],
            content: msgs[msgs.length - 1].content + content,
          };
          return { messages: msgs };
        }),
      clearMessages: () => set({ messages: [] }),
      setIsStreaming: (isStreaming) => set({ isStreaming }),

      // Permission actions
      setPendingPermission: (pendingPermission) => set({ pendingPermission }),

      // UI actions
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
    }),
    { name: "app-store" }
  )
);
