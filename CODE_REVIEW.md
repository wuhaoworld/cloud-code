# 项目代码分析报告

> 生成时间：2026-07-19
> 范围：架构、代码质量、性能、可维护性、用户体验
> 目标：作为有序优化的参考路线图

---

## 一、项目概览

- **技术栈**：Next.js 16 + React 19（App Router）+ Drizzle ORM + SQLite/Turso + Better Auth + Zustand + Vercel Sandbox
- **定位**：多租户云端 AI Coding 平台（Cloud Code），通过 Vercel Sandbox VM 隔离执行 `claude-agent-sdk`
- **架构亮点**：统一 Block 消息模型、SSE 细粒度流式协议、Sandbox onCreate/onResume + 心跳续约 + token 轮换 + 401/410 自愈

## 二、做得好的部分

1. **Sandbox 生命周期管理**（[lib/sandbox-manager.ts](file:///workspace/lib/sandbox-manager.ts)）：`creatingPromises` / `bootstrapPromises` 去重、`syncRemoteStatus` 节流、stale 引用自动失效，工程化程度高
2. **统一 Block 模型**（[store/types.ts](file:///workspace/store/types.ts)）：流式与持久化共用同一套类型，`MessageBubble` 无分支
3. **乐观 UI**：`pending-<uuid>` 占位会话 ID 不阻塞用户连续输入
4. **安全防护**：项目/会话归属双校验、IDOR 检查、sandbox 路径白名单、Bearer token、审批超时

## 三、改进建议（按优先级）

### 🔴 P0 — 立即修复

#### 1. permissionMode 默认 `bypassPermissions` 是严重安全风险
[app/api/chat/stream/route.ts:58-60](file:///workspace/app/api/chat/stream/route.ts#L58-L60) 客户端可省略字段直接绕过所有审批；[components/chat/chat-input.tsx:150](file:///workspace/components/chat/chat-input.tsx#L150) 更是硬编码 `bypassPermissions`。建议默认 `default`，UI 上明确显示当前模式并要求用户主动选择「信任模式」。

#### 2. 本地（非 sandbox）模式在生产暴露任意代码执行面
[app/api/chat/stream/route.ts:337](file:///workspace/app/api/chat/stream/route.ts#L337) 直接在 Next.js 进程跑 `query()`，AI 可在服务器文件系统读写执行。`validateProjectDirectory` 只校验项目目录本身，无法阻止 Bash 工具逃逸。建议生产环境强制 sandbox 模式，本地模式仅限 dev。

#### 3. `app/[workspace]/layout.tsx` 取「最新项目」的逻辑是反的
[app/[workspace]/layout.tsx:47](file:///workspace/app/[workspace]/layout.tsx#L47) 注释说 "updatedAt 降序，最后一个是最新"，但 `orderBy(projects.updatedAt)` 是**升序**。当前取 `workspaceProjects[length - 1]`，逻辑碰巧正确但表述错误，可读性差。改为 `.orderBy(desc(projects.updatedAt))` 后取 `[0]`，并去掉后续多次 `.reverse()`。

#### 4. ChatInput 的 previewUrls 清理是 bug
[components/chat/chat-input.tsx:280-284](file:///workspace/components/chat/chat-input.tsx#L280-L284)：

```ts
useEffect(() => {
  return () => {
    Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
  };
}, [previewUrls]);
```

每次 `previewUrls` 变化都会触发 cleanup → 添加第二张图时第一张的 ObjectURL 立刻被 revoke → 图片裂。应改为只在 unmount 时清理，用 ref 持有最新值。

#### 5. 缺少 `error.tsx` / `global-error.tsx` / `not-found.tsx`
任何 RSC 渲染抛错都会冒泡白屏；访问不存在的 workspace 直接 500。建议至少补：

- `app/global-error.tsx`（根兜底）
- `app/[workspace]/not-found.tsx`
- `app/[workspace]/error.tsx`

### 🟠 P1 — 性能与架构

#### 6. 流式 delta 引发全量消息重渲染
[store/app-store.ts:534-544](file:///workspace/store/app-store.ts#L534-L544) 的 `done`/`error` 用 `Object.fromEntries(Object.entries(messagesById).map(...))` 重建所有消息引用，所有 MessageItem 重渲染。流式期间每秒数十次 delta 也持续触发 `messagesById` 引用变更。

**建议**：

- 用 Immer 或 `structuredClone` 之前先 shallow 复制目标消息
- `MessageItem` 加 `React.memo`，仅订阅单条消息（已做）+ 父组件避免传 inline callback
- `done` 事件改用 `set((state) => { for (const id of state.messageIds) { state.messagesById[id].status = ... } })` 避免重建整个 map

#### 7. 缺少 `proxy.ts`（Next.js 16 的 middleware 重命名）
所有鉴权散落在每个 route 重复 `await auth.api.getSession`。建议加 `app/proxy.ts` 在边缘层做：

- 未登录访问受保护路由直接重定向 `/sign-in`
- 注入全局安全头（CSP、X-Frame-Options、Referrer-Policy）
- 集中收集边缘日志

#### 8. `stream/route.ts` 730 行 + 与 `sandbox-proxy.ts` 大量重复
[app/api/chat/stream/route.ts:482-690](file:///workspace/app/api/chat/stream/route.ts#L482-L690) 的 Direct 分支与 [lib/sandbox-proxy.ts:177-279](file:///workspace/lib/sandbox-proxy.ts#L177-L279) 的 `processSDKMessage` 逻辑几乎一致，注释也承认 "mirrors stream/route.ts logic"。

**建议**：抽取 `lib/sdk-message-processor.ts` 共享处理器，两条分支都调用。同时把 GET 兼容方法删掉（注释已是「临时过渡」）。

#### 9. `app-store.ts` 577 行应拆分 slice
Workspace / Project / Session / Message / Files / Permission / UI 全混在一个 store。建议拆为 `workspaceSlice` / `projectSlice` / `messageSlice` / `uiSlice`，用 zustand `combine` 或独立 store + cross-store subscription。

#### 10. `SandboxManager` 7 个模块级 Map 状态
[lib/sandbox-manager.ts:41-87](file:///workspace/lib/sandbox-manager.ts#L41-L87) 用模块级 Map（`runningInstances`, `serverUrls`, `serverTokens`, `bootstrapPromises`, `creatingPromises`, `lastActivity`, `heartbeats`），注释承认 "per-process memory"。多实例部署完全失效。

**建议**：封装为 `SandboxRegistry` 类（单例 + DB 状态作为 source of truth），或迁移到 Redis 共享状态。

#### 11. 消息历史 API 无分页
[app/api/projects/[id]/sessions/[sessionId]/messages/route.ts](file:///workspace/app/api/projects/[id]/sessions/[sessionId]/messages/route.ts) 一次性返回所有消息。长会话上千条会拖慢首屏。建议加 `?limit=50&before=<sortOrder>` 游标分页 + 客户端向上滚动加载。

#### 12. ChatInput 重复 fetch models / skills / files
[components/chat/chat-input.tsx:122-148](file:///workspace/components/chat/chat-input.tsx#L122-L148) 每次 mount 都重新请求。建议引入 SWR 或 React Query 缓存，或上提到 layout 一次预取。

#### 13. `projectFilesCacheEntry` 作为 useEffect 依赖
[components/chat/chat-input.tsx:221-223](file:///workspace/components/chat/chat-input.tsx#L221-L223) — 缓存对象每次状态更新重建引用，触发 effect 反复执行 `ensureProjectFiles`。依赖数组应只保留 `projectId`。

### 🟡 P2 — 可维护性

#### 14. 大量 `any` + eslint-disable
SDK 消息未类型化。建议从 `@anthropic-ai/claude-agent-sdk` 导入 `SDKMessage` / `SDKAssistantMessage` / `SDKUserMessage` / `SDKResultMessage` 等类型，消除 `as any`。

#### 15. `db/index.ts` 未配置 SQLite WAL 模式
本地 SQLite 默认 rollback journal，并发性能差。建议：

```ts
drizzle({ connection: { url: ... }, logger: process.env.NODE_ENV !== 'production' })
// 启动后执行 PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
```

#### 16. `auth.ts` 的 `sendResetPassword` 只 console.log
[lib/auth.ts:14-16](file:///workspace/lib/auth.ts#L14-L16) — 用户实际收不到邮件。至少接入 Resend / SendGrid，或在 UI 上明确告知「演示模式」。

#### 17. 持久化分散
`localStorage.setItem("current-workspace-id" / "expanded-projects" / "selected-model-id")` 散落各处。建议用 zustand `persist` 中间件 + `partialize` 集中管理。

#### 18. 没有任何测试框架
`scripts/test-*.ts` 是手写脚本。建议至少引入 vitest 覆盖：

- `lib/pending-permissions.ts` 的规则匹配
- `lib/sandbox-proxy.ts` 的 `processSDKMessage`
- `store/app-store.ts` 的 `applyStreamEvent` reducer
- 关键 API 路由的鉴权（401/403/IDOR）

#### 19. `bundleWithEsbuild` 用 `require()`
[lib/sandbox-setup.ts:284](file:///workspace/lib/sandbox-setup.ts#L284) 在 ESM 项目里不规范。改 `const esbuild = await import("esbuild")`。

#### 20. `SandboxManager.invalidate` fire-and-forget DB update
[lib/sandbox-manager.ts:489-492](file:///workspace/lib/sandbox-manager.ts#L489-L492) 错误被吞，可能产生 DB 与内存不一致状态。应至少 await + log。

### 🟢 P3 — 用户体验

#### 21. `pendingPermission` 是单个，并发请求会被覆盖
[store/app-store.ts:112](file:///workspace/store/app-store.ts#L112) `pendingPermission: PermissionRequest | null`。改为队列 `pendingPermissions: PermissionRequest[]`。

#### 22. PermissionDialog 替换了 ChatInput 位置
[components/chat/chat-area.tsx:450-456](file:///workspace/components/chat/chat-area.tsx#L450-L456) — 用户必须先审批才能继续输入。改为浮层 Dialog，保留输入框可用。

#### 23. 流式错误只 toast 不内联
历史会话回看时无法看到那次出错。建议在 assistant message 上展示 error status block。

#### 24. 切换会话无骨架屏
`isLoadingHistory` 时清空消息列表再填回，视觉跳跃。改为保留旧消息 + 顶部 spinner，新消息到达后替换。

#### 25. `useAgentStream` abort 不通知服务器
客户端 abort 后服务端 SSE 仍在跑直到 `req.signal` 触发 close。应在 abort 时立即 POST `/api/chat/abort` 显式取消。

### 🔵 P4 — Next.js 最佳实践

#### 26. 未用 `next/font` 优化字体
[app/layout.tsx](file:///workspace/app/layout.tsx) 设了 `font-sans` 但没 `next/font/google`。若想用 Inter/Geist 等，需 next/font 自托管。

#### 27. 未配置 `metadataBase` 和 `generateMetadata`
OG image 生成需要绝对 URL。各路由缺少动态标题。

#### 28. 未用 `output: 'standalone'`
Docker 自部署时镜像体积大。

#### 29. `app/[workspace]/chat/[projectId]/[sessionId]/page.tsx` 整个 `"use client"`
[app/[workspace]/chat/[projectId]/[sessionId]/page.tsx](file:///workspace/app/[workspace]/chat/[projectId]/[sessionId]/page.tsx) 全客户端渲染。可以拆出 header / sidebar 作为 RSC，仅 ChatArea 客户端。

#### 30. 缺少 `app/instrumentation.ts`
Sentry / OpenTelemetry 集成点缺失。

---

## 四、改进路线图建议

| 阶段 | 范围 | 关键改动 |
|---|---|---|
| **Sprint 1（紧急）** | 安全 + Bug | #1 权限默认值、#2 本地模式生产开关、#3 取最新项目 bug、#4 previewUrls、#5 错误边界 |
| **Sprint 2** | 性能 | #6 重渲染优化、#8 stream 重构、#11 分页、#12/#13 数据获取与依赖修复 |
| **Sprint 3** | 架构 | #7 proxy.ts、#9 store 拆分、#10 SandboxRegistry、#18 测试基建 |
| **Sprint 4** | UX + Next.js | #21-#25 体验优化、#26-#30 Next.js 16 优化 |

## 五、核心结论

项目的 **Sandbox 集成层工程化程度高**，是核心竞争力。但 **应用层（API route、状态管理、UI）存在多处可观察的 bug 和性能问题**，最严重的是 `permissionMode` 默认绕过审批 + 本地模式任意代码执行两条安全风险。建议先处理 P0 的 5 项，再按路线图推进。

---

## 进度跟踪

> 完成一项后可在对应条目后打勾，便于团队协作追踪。

- [ ] P0-1 权限模式默认值修正
- [ ] P0-2 本地模式生产环境开关
- [ ] P0-3 layout 取最新项目逻辑修正
- [ ] P0-4 ChatInput previewUrls 清理 bug
- [ ] P0-5 错误边界补全
- [ ] P1-6 流式重渲染优化
- [ ] P1-7 proxy.ts 鉴权中间件
- [ ] P1-8 stream/route 与 sandbox-proxy 合并
- [ ] P1-9 app-store slice 拆分
- [ ] P1-10 SandboxRegistry 抽象
- [ ] P1-11 消息历史分页
- [ ] P1-12 ChatInput 数据获取缓存
- [ ] P1-13 useEffect 依赖修复
- [ ] P2-14 SDK 类型化
- [ ] P2-15 SQLite WAL 模式
- [ ] P2-16 邮件发送接入
- [ ] P2-17 持久化集中管理
- [ ] P2-18 测试框架引入
- [ ] P2-19 esbuild 动态 import
- [ ] P2-20 invalidate 错误处理
- [ ] P3-21 权限请求队列化
- [ ] P3-22 PermissionDialog 浮层化
- [ ] P3-23 错误内联展示
- [ ] P3-24 会话切换骨架屏
- [ ] P3-25 显式 abort 通知
- [ ] P4-26 next/font 接入
- [ ] P4-27 metadataBase 配置
- [ ] P4-28 standalone 输出
- [ ] P4-29 RSC 边界拆分
- [ ] P4-30 instrumentation.ts
