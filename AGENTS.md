# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动 Next.js 开发服务器 |
| `npm run build` | 生产环境构建 |
| `npm run start` | 运行生产服务器 |
| `npm run lint` | 运行 ESLint |
| `npm run syncdb` | 推送 Drizzle schema 到数据库（`drizzle-kit push`） |

项目未配置测试框架。数据库迁移：`npx drizzle-kit`。

## 架构

**Next.js 16 + React 19**，使用 App Router（`app/` 目录）。TypeScript（严格模式），Tailwind CSS v4（CSS 方式配置，位于 `app/globals.css` —— 无 `tailwind.config.js`）。

### 分层结构

- **UI 层：** shadcn/ui 组件位于 `components/ui/`（radix-vega 风格，`cva` 变体，`cn()` 工具函数来自 `lib/utils.ts`）。组件使用 `data-slot` 属性和 `"use client"` 指令。额外使用 `@base-ui/react` 组件库。
- **状态管理：** Zustand store（`store/app-store.ts`），配合统一消息 Block 模型（`store/types.ts`）。
- **数据库层：** Drizzle ORM + SQLite（本地）/ Turso（生产环境）。连接配置在 `db/index.ts`（通过 `TURSO_DATABASE_URL` 环境变量区分环境），认证 schema 在 `db/auth-schema.ts`，业务 schema 在 `db/schema.ts`。本地数据库文件：`.data/app.db`（已 gitignore）。
- **认证层：** Better Auth，配置在 `lib/auth.ts` —— 邮箱+密码登录，Drizzle 适配器，SQLite 提供者。需要环境变量：`DB_FILE_NAME`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`。
- **Sandbox 层：** E2B Sandbox 集成（`e2b`），workspace 级隔离。核心模块：
  - `lib/sandbox-manager.ts` — E2B Sandbox 生命周期管理（创建/恢复、心跳、暂停、销毁）
  - `lib/sandbox-setup.ts` — E2B VM 引导（安装依赖、启动 in-sandbox HTTP 服务器）
  - `lib/sandbox-proxy.ts` — SSE 代理层，将 sandbox 内事件转发为统一客户端协议
  - `lib/sandbox-approvals.ts` — Sandbox 权限审批队列
  - `lib/sandbox-server/index.ts` — 运行在 Sandbox VM 内的 Express HTTP 服务器（端口 3001），提供 `/stream`、`/approve`、`/health` 路由
- **插件系统：** 读取 `~/.claude/plugins/` 下已安装插件（`lib/plugins.ts`），支持 Skills、Commands、MCP Servers。
- **权限模式：** `lib/permission-mode.ts` 定义五种模式（default / acceptEdits / bypassPermissions / plan / auto）。

### 路由结构

```
app/
├── (auth)/              # 认证页面（sign-in, sign-up, forgot-password, reset-password）
├── [workspace]/         # 工作区动态路由（需认证）
│   ├── chat/
│   │   └── [projectId]/[sessionId]/  # 具体会话聊天页
│   ├── settings/        # 工作区设置
│   └── plugins/[pluginId]/           # 插件详情
├── chat/                # 全局聊天页（onboarding + 路由跳转）
└── api/
    ├── auth/[...all]/   # Better Auth API
    ├── chat/
    │   ├── stream/      # POST — SSE 流式 AI 对话（核心 API）
    │   └── approve/     # POST — 权限审批
    ├── workspaces/[id]/sandbox/  # Sandbox 管理
    ├── projects/[id]/
    │   ├── sessions/           # 会话 CRUD
    │   ├── sessions/[sessionId]/messages/  # 消息持久化
    │   ├── files/              # 项目文件操作
    │   └── skills/             # 项目 Skills
    ├── plugins/[pluginId]/     # 插件管理（logo, enabled）
    └── settings/models/        # 模型配置
```

### 数据模型

- **Workspace** — 用户的工作区，包含 E2B sandbox 状态（idle / starting / running / paused）
- **Project** — 工作区下的项目，关联本地/sandbox 路径
- **ProjectSession** — 会话元数据（标题、Git 分支、置顶状态）
- **ChatMessage** — 持久化聊天消息（role、type、content、toolCallJson）

### SSE 流式协议

客户端与服务端通过统一的 `StreamEvent` 类型通信（定义在 `store/types.ts`）：
- `session_init` / `text_delta` / `thinking_delta` / `thinking_done`
- `tool_start` / `tool_end`
- `permission_request` / `permission_resolved`
- `done` / `error`

### 关键组件

- `components/chat/` — 聊天界面（ChatArea, MessageBubble, ToolCallCard, PermissionDialog, ChatInput）
- `components/sidebar/` — 侧边栏（AppSidebar, ProjectTree, WorkspaceSwitcher, SearchPanel）
- `components/project/` — 项目管理（CreateProjectDialog）
- `components/plugins/` — 插件 UI（PluginEnabledSwitch, PluginGlyph）

## 环境变量

| 变量 | 用途 |
|---|---|
| `DB_FILE_NAME` | 本地 SQLite 数据库路径（默认 `file:.data/app.db`） |
| `TURSO_DATABASE_URL` | Turso 生产数据库 URL（设置后启用云数据库） |
| `TURSO_AUTH_TOKEN` | Turso 认证 token |
| `BETTER_AUTH_SECRET` | Better Auth 密钥 |
| `BETTER_AUTH_URL` | Better Auth 公共 URL |
| `E2B_API_KEY` | E2B API key（Sandbox 功能） |
| `E2B_TEMPLATE_ID` | 可选 E2B Template ID；未设置时使用 `base` |

## Next.js 16 注意事项

此版本存在破坏性变更 —— API、约定和文件结构可能与训练数据不同。编写 Next.js 代码前，请先阅读 `node_modules/next/dist/docs/` 中的相关指南。注意弃用通知。
