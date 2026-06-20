# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动 Next.js 开发服务器 |
| `npm run build` | 生产环境构建 |
| `npm run start` | 运行生产服务器 |
| `npm run lint` | 运行 ESLint |

项目未配置测试框架。数据库迁移：`npx drizzle-kit`。

## 架构

**Next.js 16 + React 19**，使用 App Router（`app/` 目录）。TypeScript（严格模式），Tailwind CSS v4（CSS 方式配置，位于 `app/globals.css` —— 无 `tailwind.config.js`）。

### 分层结构

- **UI 层：** shadcn/ui 组件位于 `components/ui/`（radix-vega 风格，`cva` 变体，`cn()` 工具函数来自 `lib/utils.ts`）。组件使用 `data-slot` 属性和 `"use client"` 指令。
- **数据库层：** Drizzle ORM + SQLite（`@libsql/client`）。连接配置在 `db/index.ts`，认证 schema 在 `db/auth-schema.ts`，业务 schema 在 `db/schema.ts`。数据库文件：`.data/app.db`（已 gitignore）。
- **认证层：** Better Auth，配置在 `lib/auth.ts` —— 邮箱+密码登录，Drizzle 适配器，SQLite 提供者。需要环境变量：`DB_FILE_NAME`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`。

### 已安装但尚未接入

`@anthropic-ai/claude-agent-sdk`、`streamdown`、`recharts`、`cmdk`、`react-resizable-panels`、`sonner`、`zustand` —— 计划用于 AI 聊天界面，包含图表、命令面板和 Toast 通知。

## Next.js 16 注意事项

此版本存在破坏性变更 —— API、约定和文件结构可能与训练数据不同。编写 Next.js 代码前，请先阅读 `node_modules/next/dist/docs/` 中的相关指南。注意弃用通知。
