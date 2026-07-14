import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// Workspace 表
export const workspaces = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(), // 全局唯一的自定义 ID / 路由 Slug
    name: text("name").notNull(), // 显示名称
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Sandbox 字段
    sandboxId: text("sandbox_id"), // 当前运行的 Vercel Sandbox 实例 ID
    sandboxSnapshotId: text("sandbox_snapshot_id"), // 最新快照 ID（下次启动时恢复）
    sandboxStatus: text("sandbox_status", {
      enum: ["idle", "starting", "running", "snapshotting"],
    })
      .notNull()
      .default("idle"),
    sandboxToken: text("sandbox_token"),
    sandboxUrl: text("sandbox_url"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("workspace_userId_idx").on(table.userId)]
);

// 项目表
export const projects = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(), // UUID
    name: text("name").notNull(), // 项目显示名称
    path: text("path").notNull(), // 物理目录绝对路径（sandbox 模式下为相对路径）
    defaultModel: text("default_model").default("claude-opus-4-5"), // 默认模型
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }), // 所属 workspace（null = 不使用 sandbox）
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("project_userId_idx").on(table.userId)]
);

// 会话与项目的映射表
// (除了 SDK 本地 JSONL 存储，数据库同步记录元数据，方便多租户快速检索)
export const projectSessions = sqliteTable(
  "project_session",
  {
    sessionId: text("session_id").primaryKey(), // SDK 产生的 sessionUuid
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(), // 会话标题（取自首个 prompt 的前 50 字）
    gitBranch: text("git_branch"), // 所在 Git 分支
    pinnedAt: integer("pinned_at", { mode: "timestamp_ms" }), // 置顶时间，null 表示未置顶
    lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("session_projectId_idx").on(table.projectId)]
);

// 聊天消息表（持久化对话历史，刷新后可恢复）
export const chatMessages = sqliteTable(
  "chat_message",
  {
    id: text("id").primaryKey(), // UUID
    sessionId: text("session_id")
      .notNull()
      .references(() => projectSessions.sessionId, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    // type: text / thinking / tool_call
    type: text("type").notNull().default("text"),
    content: text("content").notNull().default(""),
    // 工具调用信息（JSON 序列化存储）
    toolCallJson: text("tool_call_json"),
    sortOrder: integer("sort_order").notNull(), // 消息在会话中的顺序
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("msg_sessionId_idx").on(table.sessionId)]
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectSession = typeof projectSessions.$inferSelect;
export type NewProjectSession = typeof projectSessions.$inferInsert;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
