# Sandbox 超时后通过 Snapshot 快速恢复

## 问题分析

当前代码在 sandbox 超时后会创建全新的 sandbox，而不是从 Vercel 自动保存的 snapshot 恢复。具体问题：

1. **超时恢复创建新 sandbox**：`getOrCreate` 中 `Sandbox.get()` 失败后，直接创建新 sandbox。虽然会从 DB 中的 `sandboxSnapshotId` 恢复，但该 ID 可能是过时的（不是超时时 Vercel 自动生成的 snapshot）。

2. **`checkpoint()` 状态不一致**：`sandbox.snapshot()` 会停止 VM，但代码仍将状态设为 "running"，导致内存中持有已停止的 sandbox 引用。

3. **超时后 snapshot ID 未保存**：sandbox 自然超时后，Vercel 的 `persistent: true`（默认）会自动创建 snapshot，但该 ID 从未写入 DB。

4. **`serverUrls` 缓存未清理**：heartbeat 的 catch 块清理了 `runningInstances` 但没有清理 `serverUrls`，导致超时后使用过时的 URL。

5. **Bootstrap 不必要地重复运行**：从 snapshot 恢复后 `node_modules` 已存在，但仍会重新运行 `npm install`。

## 修改方案

### 核心思路

利用 `@vercel/sandbox` v2 的 `persistent: true`（默认）特性：
- sandbox 超时 → Vercel 自动 snapshot → VM 停止
- 下次 `Sandbox.get()` → 获取 sandbox → 运行命令时自动从 snapshot 恢复
- 恢复后 `node_modules` 完整保留，无需重新安装
- 只需重启 in-sandbox server 进程

### 修改文件

#### 1. `lib/sandbox-manager.ts`

**`getOrCreate` 方法**：使用 SDK 的 `Sandbox.getOrCreate` 替代手动 get/create 逻辑：
- `onCreate`：首次创建时运行 bootstrap（上传文件、npm install、启动 server）
- `onResume`：恢复时检查 server 是否存活，不存活则重启
- 使用 `keepLastSnapshots: { count: 1 }` 控制存储成本

**`checkpoint` 方法**：修复状态管理：
- snapshot 后 sandbox 停止，应清理内存缓存
- 更新 DB 中的 `sandboxSnapshotId`
- 状态设为 "idle"（而非 "running"）

**Heartbeat catch 块**：增加 `serverUrls` 清理。

#### 2. `lib/sandbox-setup.ts`

**新增 `restartServerIfStopped` 函数**：
- 先 health check，如果 server 已在运行则跳过
- 不在运行则运行完整 bootstrap 流程
- 用于 `onResume` 回调

#### 3. `lib/sandbox-manager.ts` — `ensureServerRunning`

增加 health check：返回缓存 URL 前验证 server 是否存活，不存活则重新 bootstrap。

## 详细实现

### `lib/sandbox-setup.ts` — 新增函数

```typescript
/**
 * Restart the in-sandbox server if it's not already running.
 * Checks /health first — skips bootstrap if the server is already alive.
 * Used in the onResume callback after a sandbox is restored from snapshot.
 */
export async function restartServerIfStopped(sandbox: SandboxInstance): Promise<string> {
  const baseUrl = sandbox.domain(SERVER_PORT);

  // Quick health check — if the server survived the resume, skip bootstrap
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) return baseUrl;
  } catch {
    // Not running, proceed with bootstrap
  }

  return bootstrapSandboxServer(sandbox);
}
```

### `lib/sandbox-manager.ts` — 重写 `getOrCreate`

```typescript
static async getOrCreate(workspaceId: string) {
    touchActivity(workspaceId);

    const cached = runningInstances.get(workspaceId);
    if (cached) return cached;

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    const Sandbox = await getSandboxClass();
    const credentials = getCredentials();

    let sandbox: InstanceType<typeof Sandbox>;

    // Use SDK's getOrCreate — handles both fresh creation and resume from snapshot.
    // persistent: true (default) means Vercel auto-snapshots on timeout,
    // and the sandbox resumes from the latest snapshot automatically.
    sandbox = await Sandbox.getOrCreate({
      name: workspace.sandboxId ?? undefined,
      ...credentials,
      runtime: "node24",
      timeout: INITIAL_TIMEOUT_MS,
      ports: [3001],
      keepLastSnapshots: { count: 1 },
      onCreate: async (sbx) => {
        await bootstrapSandboxServer(sbx);
      },
      onResume: async (sbx) => {
        await restartServerIfStopped(sbx);
      },
    });

    runningInstances.set(workspaceId, sandbox);
    startHeartbeat(workspaceId, sandbox);

    await db
      .update(workspaces)
      .set({ sandboxId: sandbox.name, sandboxStatus: "running" })
      .where(eq(workspaces.id, workspaceId));

    return sandbox;
  }
```

### `lib/sandbox-manager.ts` — 修复 `checkpoint`

```typescript
static async checkpoint(workspaceId: string) {
    const sandbox = runningInstances.get(workspaceId);
    if (!sandbox) return;

    await db
      .update(workspaces)
      .set({ sandboxStatus: "snapshotting" })
      .where(eq(workspaces.id, workspaceId));

    try {
      const snap = await sandbox.snapshot();
      // snapshot() stops the sandbox — clean up in-memory state
      // and record the snapshot ID for future restoration.
      stopHeartbeat(workspaceId);
      runningInstances.delete(workspaceId);
      serverUrls.delete(workspaceId);
      bootstrapPromises.delete(workspaceId);
      await db
        .update(workspaces)
        .set({ sandboxSnapshotId: snap.snapshotId, sandboxStatus: "idle" })
        .where(eq(workspaces.id, workspaceId));
    } catch (err) {
      await db
        .update(workspaces)
        .set({ sandboxStatus: "running" })
        .where(eq(workspaces.id, workspaceId));
      throw err;
    }
  }
```

### `lib/sandbox-manager.ts` — Heartbeat catch 块增加 `serverUrls` 清理

```typescript
} catch {
  stopHeartbeat(workspaceId);
  runningInstances.delete(workspaceId);
  serverUrls.delete(workspaceId);  // ← 新增
}
```

### `lib/sandbox-manager.ts` — `ensureServerRunning` 增加 health check

```typescript
static async ensureServerRunning(
    workspaceId: string,
    sandbox: InstanceType<typeof import("@vercel/sandbox").Sandbox>
  ): Promise<string> {
    const cached = serverUrls.get(workspaceId);
    if (cached) {
      // Verify the cached server is still alive — after a sandbox
      // timeout + snapshot restore, the process is dead even though
      // we have a cached URL.
      try {
        const res = await fetch(`${cached}/health`, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) return cached;
      } catch {
        // Server is dead — fall through to re-bootstrap
      }
      serverUrls.delete(workspaceId);
    }

    const inFlight = bootstrapPromises.get(workspaceId);
    if (inFlight) return inFlight;

    const promise = bootstrapSandboxServer(sandbox)
      .then((baseUrl) => {
        serverUrls.set(workspaceId, baseUrl);
        return baseUrl;
      })
      .finally(() => {
        bootstrapPromises.delete(workspaceId);
      });

    bootstrapPromises.set(workspaceId, promise);
    return promise;
  }
```

## 测试验证

1. 启动 sandbox，发送聊天消息
2. 等待 heartbeat 停止续期（15 分钟无活动），sandbox 自然超时
3. 再次发送聊天消息 — 应从 snapshot 恢复，无需重新 `npm install`
4. 验证 DB 中 `sandboxStatus` 正确转换
5. 手动触发 checkpoint — 验证 sandbox 停止后状态变为 "idle"
6. checkpoint 后再次启动 — 应从 checkpoint 的 snapshot 恢复
