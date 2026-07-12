# 代码审查待办清单

> 基于 2026-07-12 对项目代码的完整静态审查，覆盖配置、API 路由、页面组件、sandbox/chat 核心逻辑、状态管理五个层次。
>
> 优先级说明：P0 = 安全/数据正确性，必须立即修复；P1 = 架构/性能/可维护性；P2 = 代码质量。

---

## 项目概览

**技术栈**：Next.js 16 + React 19 + App Router、Drizzle ORM（实际接 Turso/libSQL）、Better Auth、Vercel Sandbox + Claude Agent SDK、Zustand、shadcn/ui、Tailwind v4。

**整体评价**：业务功能完整、技术选型现代，正确运用了 Next.js 16 的 async `params`、Server Component、`use(params)` 等新约定。但在 **安全鉴权一致性、RSC 边界下沉、流式性能、资源生命周期管理** 四个维度存在系统性问题，需要优先治理。

---

## P0 — 严重问题（安全 + 数据正确性，必须立即修复）

- [ ] **1. 两个 API 路由完全无鉴权**
  - [app/api/plugins/[pluginId]/enabled/route.ts](app/api/plugins/%5BpluginId%5D/enabled/route.ts)：整个 PATCH 无 `getSession`，且插件配置写入 `~/.claude/settings.json` 是**全局共享**的，任意未认证用户可改写影响所有用户。
  - [app/api/settings/models/route.ts](app/api/settings/models/route.ts)：GET 无鉴权，向任意请求者暴露服务端 `~/.claude/settings.json` 中的模型配置。

- [ ] **2. IDOR：approve 接口可跨用户审批**
  - [app/api/chat/approve/route.ts](app/api/chat/approve/route.ts) 校验了登录，但 `requestId` 查找时（行 32、54）不比对 `pending.sessionPermissionKey` 中的 `userId`。任意登录用户猜中 UUID 即可批准/拒绝**他人**会话中的工具权限请求。
  - 同文件还存在 `action` 枚举未校验（行 24），沙箱分支默认把非法值当 `allow` 放行。

- [ ] **3. resume session 未校验归属**
  - [app/api/chat/stream/route.ts](app/api/chat/stream/route.ts) 行 438-439 直接用客户端传入 `sessionId` resume，仅校验 `projectId` 归属，未校验 sessionId 是否属于该 project。可造成跨项目上下文串扰。

- [ ] **4. Sandbox 内 HTTP 服务无鉴权**
  - [lib/sandbox-server/index.ts](lib/sandbox-server/index.ts) 的 `/stream`、`/approve`、`/health` 均无 token 校验，而 `sandbox.domain()` 返回的是 Vercel 公网 HTTPS 域名。任何拿到 URL 的人可消耗 Anthropic 额度、自动批准自己的权限请求、读取沙箱文件。安全性完全依赖"域名不可猜"。

- [ ] **5. 客户端断连不传播到 sandbox SDK → 孤儿查询**
  - [lib/sandbox-server/index.ts](lib/sandbox-server/index.ts) 行 56 的 `/stream` handler 未监听 `req.on('close')`，客户端 abort 后 SDK 的 `for await (const message of query(...))` 循环不中止，继续消耗 token、可能执行未授权工具调用。

- [ ] **6. 内存泄漏：两处 Map 永不清理**
  - [lib/sandbox-approvals.ts](lib/sandbox-approvals.ts) `pendingSandboxApprovals` 仅在 approve 时删除，sandbox 内 5 分钟超时或流 abort 后条目永不清理。
  - [lib/pending-permissions.ts](lib/pending-permissions.ts) `sessionPermissionUpdates` 无 evict/clear 调用，随会话单调增长。

- [ ] **7. `stop()` 后删除 workspace 漏清理远端快照**
  - [lib/sandbox-manager.ts](lib/sandbox-manager.ts) 行 300 把 `sandboxId` 置 null，导致 [app/api/workspaces/[id]/route.ts](app/api/workspaces/%5Bid%5D/route.ts) 行 54 的 `if (workspace.sandboxId)` 判断为假，跳过远端 `sandbox.delete()`。残留快照永久计费。
  - 应改用 `workspace.id` 定位（sandbox name 恒等于 workspace.id）。

- [ ] **8. 环境变量配置严重不一致**
  - [db/index.ts](db/index.ts) 实际使用 `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`（Turso 远程）。
  - [.sample.env](.sample.env) 只列了 `DB_FILE_NAME="file:.data/app.db"`，完全没列 Turso 变量。
  - [AGENTS.md](AGENTS.md) 与 [CLAUDE.md](CLAUDE.md) 仍说"SQLite 本地文件 `.data/app.db`"，注释掉的旧代码 `// export const db = drizzle(process.env.DB_FILE_NAME!)` 还留在 [db/index.ts:4](db/index.ts)。
  - [lib/auth-client.ts](lib/auth-client.ts) 用 `NEXT_PUBLIC_BETTER_AUTH_URL`，`.sample.env` 也未列。
  - 新人按 `.sample.env` 部署必然启动失败。

---

## P1 — 架构问题（性能 + 可维护性）

- [ ] **9. 客户端 redirect 瀑布 — 应改 Server Component + `redirect()`**
  - [app/page.tsx](app/page.tsx) 是正确范例（Server Component 直接 `redirect`）。但 7 个页面退化成"客户端 useEffect → fetch → router.replace"：
    - [app/chat/page.tsx](app/chat/page.tsx)、[app/chat/settings/page.tsx](app/chat/settings/page.tsx)、[app/plugins/page.tsx](app/plugins/page.tsx)、[app/plugins/[pluginId]/page.tsx](app/plugins/%5BpluginId%5D/page.tsx) — 都是 fetch workspace 后 redirect
    - [app/chat/[projectId]/page.tsx](app/chat/%5BprojectId%5D/page.tsx)、[app/chat/[projectId]/[sessionId]/page.tsx](app/chat/%5BprojectId%5D/%5BsessionId%5D/page.tsx) — fetch project 后 redirect
    - [app/[workspace]/page.tsx](app/%5Bworkspace%5D/page.tsx) — client component 仅用 `use(params)` + `router.replace`
  - 造成"白屏→请求→重定向→再渲染"的串行瀑布，首屏体验差。

- [ ] **10. 大量数据在 Client Component 的 useEffect 中拉取**
  - [components/sidebar/project-tree.tsx](components/sidebar/project-tree.tsx) 行 76 先 fetch projects，回来再 `Promise.all` fetch 每个 project 的 sessions — **典型数据瀑布**。
  - [components/sidebar/workspace-switcher.tsx](components/sidebar/workspace-switcher.tsx)、[components/sidebar/search-panel.tsx](components/sidebar/search-panel.tsx)、[components/chat/chat-input.tsx](components/chat/chat-input.tsx) 同样模式。
  - 应在 Server Component 预取后用 props 传给 client 子组件，或用一次 SQL join。

- [ ] **11. 缺少 loading.tsx / error.tsx / not-found.tsx 约定文件**
  - 整个 `app/` 目录无任何约定文件。路由级错误无 fallback UI，`notFound()` 调用走默认 404，与项目 UI 风格不一致。
  - 应至少在 `app/`、`app/(auth)/`、`app/[workspace]/` 补齐 `loading.tsx` + `error.tsx`。

- [ ] **12. 流式期间过度重渲染 — store 订阅粒度过粗**
  - 15+ 组件用 `useAppStore()` 无 selector 解构整个 store（如 [components/sidebar/sidebar.tsx:32](components/sidebar/sidebar.tsx)、[app/chat/[projectId]/page.tsx:29](app/chat/%5BprojectId%5D/page.tsx) 一次解构 11+ 字段）。
  - `applyStreamEvent` 每个 token 触发 `set({ messages })`，导致 sidebar、settings、workspace-switcher 等无关组件**按 token 全量重渲染**。
  - 叠加 [app-store.ts:48-50](store/app-store.ts) 的 `messages.map(...)` 每 token O(n) 重建数组，长对话性能线性衰减。
  - 应改用细粒度 selector（`useAppStore(s => s.xxx)`，已有正确范例 [use-agent-stream.ts:43](hooks/use-agent-stream.ts)），并把 messages 拆成 by-id 字典 + id 数组避免全量重建。

- [ ] **13. 重型库进 client bundle**
  - [components/chat/message-bubble.tsx](components/chat/message-bubble.tsx) 行 6-11 直接 `import Streamdown` + `@streamdown/code` + `@streamdown/cjk` + `katex/dist/katex.min.css`，每条消息都渲染。
  - 应 `next/dynamic` 懒加载首次使用时再拉 chunk。
  - [app/layout.tsx](app/layout.tsx) 行 3 全局引入 `streamdown/styles.css`，导致 auth、plugins 页也加载。

- [ ] **14. 鉴权样板代码大量重复 + 无集中式鉴权**
  - 12+ 处重复同样的 4 行 session 校验块，6+ 处重复"项目归属校验"模式。
  - 项目根目录无 `proxy.ts`（Next.js 16 已将 middleware 重命名为 proxy）做集中拦截，导致 P0 的两个无鉴权路由漏网。
  - 应：
    - 抽取 `lib/api-auth.ts`：`requireSession()`、`getOwnedProject(id, userId)`、`getOwnedSession(projectId, sessionId)`。
    - 增加 `proxy.ts` 拦截 `/api/*`（白名单 `/api/auth/*`）。

- [ ] **15. chat/stream/route.ts 单文件 688 行，沙箱与本地分支大量重复**
  - [app/api/chat/stream/route.ts](app/api/chat/stream/route.ts) 沙箱分支（行 160-297）与本地分支（行 299-651）的消息持久化逻辑几乎一致，`projectSessions` 的 insert/onConflict 在三处重复。
  - 应抽 `lib/chat-persist.ts` 统一落库。
  - 行 671-688 的 GET 兼容层违反 HTTP 语义（GET 产生副作用），应移除。

- [ ] **16. sandbox 生命周期与并发问题**
  - [lib/sandbox-manager.ts](lib/sandbox-manager.ts) 行 78 的 `setInterval` 心跳未 `.unref()`，阻止进程优雅退出。
  - `getOrCreate` 的 `onCreate`/`onResume` 回调（行 175-184）启动了 sandbox 内服务但**不写入 `serverUrls` 缓存**，导致 `ensureServerRunning` 重复 bootstrap（每次冷启动多一次完整 bundle 上传 + 命令执行）。
  - `stop()` 中 `sandbox.stop()` 抛错时 DB 卡在 "running"（行 296-301）。
  - `checkpoint`（行 255-282）与进行中的流无互斥，snapshot 会停 VM 导致正在进行的 chat 流连接拒绝失败且不重试。
  - `syncRemoteStatus`（行 365-410）把任何异常都当 idle，网络抖动会误判并 invalidate。
  - 进程崩溃后 DB 永久停在 "running"，无启动时自愈扫描。

- [ ] **17. 元数据完全缺失**
  - `generateMetadata` 全项目 0 处使用，[app/layout.tsx](app/layout.tsx) 仅静态 title。
  - 无 `metadataBase`、无 OG image、无 twitter card、无 viewport 导出。
  - 动态页面（plugin、session）应基于数据生成 `<title>`。

- [ ] **18. `next/font` / `next/image` 未使用**
  - [app/layout.tsx](app/layout.tsx) 未用 `next/font` 引入字体（`globals.css` 的 `--font-sans` 变量未定义来源）。
  - [components/chat/chat-input/AttachmentCard.tsx](components/chat/chat-input/AttachmentCard.tsx) 行 36 用裸 `<img>` 而非 `next/image`。

---

## P2 — 代码质量问题

- [ ] **19.** `req.json()` 5 处无 try/catch，非法 JSON 直接 500
  - [approve/route.ts:18](app/api/chat/approve/route.ts)、[projects/route.ts:41](app/api/projects/route.ts)、[projects/[id]/route.ts:19](app/api/projects/%5Bid%5D/route.ts)、[sessions/[sessionId]/route.ts:52](app/api/projects/%5Bid%5D/sessions/%5BsessionId%5D/route.ts)、[workspaces/route.ts:70](app/api/workspaces/route.ts)

- [ ] **20.** 无 zod，输入校验用 `body as {...}` 类型断言（多处）

- [ ] **21.** DELETE workspace 无事务，sandbox 已删 + DB 失败 → 不一致
  - [workspaces/[id]/route.ts:76-81](app/api/workspaces/%5Bid%5D/route.ts)

- [ ] **22.** workspaces POST 存在 TOCTOU 竞态（先 select 后 insert）
  - [workspaces/route.ts:100-125](app/api/workspaces/route.ts)

- [ ] **23.** 同步 FS 操作阻塞事件循环（readdirSync + readFileSync 循环）
  - [projects/[id]/files/route.ts:55](app/api/projects/%5Bid%5D/files/route.ts)
  - [projects/[id]/skills/route.ts:60-80](app/api/projects/%5Bid%5D/skills/route.ts)

- [ ] **24.** page 文件同时 export default + 具名组件，跨路由复用
  - [app/chat/[projectId]/page.tsx:176](app/chat/%5BprojectId%5D/page.tsx) 的 `ChatArea` 应抽到独立文件

- [ ] **25.** `Set` 作为 store state，devtools 序列化为 `{}`
  - [app-store.ts:69](store/app-store.ts)

- [ ] **26.** localStorage 写但永不读（死代码）— `expandedProjects` 持久化无效
  - [app-store.ts:202-204](store/app-store.ts)

- [ ] **27.** `use-agent-stream` 卸载时不 abort 进行中的流；`send` 无并发保护
  - [use-agent-stream.ts:48,86](hooks/use-agent-stream.ts)

- [ ] **28.** `uuid` 包可用 Web 标准 `crypto.randomUUID()` 替代
  - [use-agent-stream.ts:7](hooks/use-agent-stream.ts)

- [ ] **29.** store 文件缺 `"use client"` 防御性标注
  - [app-store.ts](store/app-store.ts)

- [ ] **30.** sandbox 模式不支持 `approve_permanent`（功能缺失）
  - [sandbox-server/index.ts:47-52](lib/sandbox-server/index.ts)

- [ ] **31.** 三个 layout 文件高度重复（auth check + AppSidebar + main）
  - [app/[workspace]/layout.tsx](app/%5Bworkspace%5D/layout.tsx)、app/chat/layout.tsx、app/plugins/layout.tsx

- [ ] **32.** types.ts 存在 `Record<string, any>` 与 `Record<string, unknown>` 不一致
  - [types.ts:19-20](store/types.ts)

- [ ] **33.** Render 期间调用 setState 反模式
  - [message-bubble.tsx:218-221](components/chat/message-bubble.tsx)

- [ ] **34.** `serverExternalPackages: ["esbuild"]` 但 esbuild 不在 deps
  - [next.config.ts:4](next.config.ts)

- [ ] **35.** 无测试框架（package.json 无 test script）
  - [package.json](package.json)

---

## 做得好的地方（无需改动）

1. **Server Component 正确范例**：[app/page.tsx](app/page.tsx)、[app/[workspace]/layout.tsx](app/%5Bworkspace%5D/layout.tsx)、plugins 页正确用 `async function` + `await params` + `redirect()`/`notFound()`。
2. **Next.js 16 async params 全面正确**：所有 Server Component 用 `params: Promise<{...}>` + `await params`；client 用 `use(params)`。
3. **`Promise.all` 并行加载**：[app/[workspace]/plugins/[pluginId]/page.tsx](app/%5Bworkspace%5D/plugins/%5BpluginId%5D/page.tsx) 行 33-37 正确并行加载 skills/mcpServers/commands。
4. **`PluginEnabledSwitch` 用 `useTransition`** + 失败回滚 optimistic state。
5. **`PluginGlyph` 是纯 Server Component**，无 hydration 成本。
6. **SQL 注入安全**：全部用 Drizzle 参数化查询，无原始 SQL 拼接。
7. **runtime 默认 Node.js 正确**（项目用了 fs、better-sqlite3、@vercel/sandbox）。
8. **reset-password 正确用 Suspense 包 `useSearchParams`**。

---

## 建议的处理顺序

### 第一阶段：立即（P0）
- [ ] 1. 补齐 `plugins/[pluginId]/enabled`、`settings/models` 鉴权（或在 `proxy.ts` 集中拦截）
- [ ] 2. 修复 `chat/approve` IDOR：approve 前比对 `sessionPermissionKey` 的 userId + 校验 `action` 枚举
- [ ] 3. `chat/stream` resume 前查 `projectSessions` 确认 sessionId 属于该 project
- [ ] 4. sandbox 内 HTTP 服务加 token 鉴权
- [ ] 5. 客户端断连传播 abort 到 sandbox SDK
- [ ] 6. `pendingSandboxApprovals` / `sessionPermissionUpdates` 加超时清理或 LRU
- [ ] 7. 修复 `stop()` 后 DELETE 漏清理远端快照（改用 `workspace.id` 定位）
- [ ] 8. 同步 `.sample.env` 与 [db/index.ts](db/index.ts) 实际所需变量，更新 CLAUDE.md

### 第二阶段：短期（P1，性能 + 可维护性）
- [ ] 9. 抽 `lib/api-auth.ts` 统一 session/ownership 校验 + 增加 `proxy.ts` 集中鉴权
- [ ] 10. 7 个客户端 redirect 改 Server Component + `redirect()`
- [ ] 11. sidebar 数据获取改 Server Component 预取（消除 project-tree 数据瀑布）
- [ ] 12. 补齐 `loading.tsx` / `error.tsx` / `not-found.tsx`
- [ ] 13. store 订阅细粒度化（15+ 处改 selector）；messages 改 by-id 字典
- [ ] 14. `message-bubble` 的 Streamdown 改 `next/dynamic` 懒加载
- [ ] 15. 引入 zod + `lib/validations/` 统一输入校验；所有 `req.json()` 包 try/catch
- [ ] 16. 抽 `lib/chat-persist.ts` 拆分 `chat/stream/route.ts`；移除 GET 兼容层

### 第三阶段：中期（P1-P2，健壮性）
- [ ] 17. sandbox 生命周期：心跳 `.unref()`、`onCreate`/`onResume` 写 `serverUrls`、`stop()` 包 try/catch、checkpoint 与流互斥、启动时自愈扫描"幽灵 running"
- [ ] 18. 引入 `next/font`、`next/image`；补 `generateMetadata` + OG
- [ ] 19. 三个 layout 抽公共组件；`ChatArea` 移出 page 文件
- [ ] 20. 引入测试框架（vitest）+ 关键路径测试（鉴权、IDOR、流式）

---

*报告基于 2026-07-12 当前磁盘代码静态分析生成。每条处理完成后请勾选对应 checkbox。*
