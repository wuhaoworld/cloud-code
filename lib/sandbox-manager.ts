import { Sandbox, SandboxNotFoundError } from "e2b";
import { bootstrapSandboxServer } from "./sandbox-setup";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";

export type SandboxStatus = "idle" | "starting" | "running" | "paused";
type E2BSandbox = Sandbox;

const INITIAL_TIMEOUT_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
const IDLE_RENEWAL_CUTOFF_MS = 30 * 60 * 1000;
const MIN_REMOTE_STATUS_CHECK_INTERVAL_MS = 3_000;

const runningInstances = new Map<string, E2BSandbox>();
const serverUrls = new Map<string, string>();
const serverTokens = new Map<string, string>();
const bootstrapPromises = new Map<string, Promise<{ baseUrl: string; token: string }>>();
const creatingPromises = new Map<string, Promise<E2BSandbox>>();
const lastActivity = new Map<string, number>();
const lastRemoteStatusCheck = new Map<string, number>();
const heartbeats = new Map<string, ReturnType<typeof setInterval>>();

function e2bOptions() {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY is required to use sandbox workspaces");
  return { apiKey };
}

function sandboxTemplate() {
  return process.env.E2B_TEMPLATE_ID?.trim() || "base";
}

function touchActivity(workspaceId: string) {
  lastActivity.set(workspaceId, Date.now());
}

function stopHeartbeat(workspaceId: string) {
  const handle = heartbeats.get(workspaceId);
  if (handle) clearInterval(handle);
  heartbeats.delete(workspaceId);
}

function clearRuntimeState(workspaceId: string) {
  stopHeartbeat(workspaceId);
  runningInstances.delete(workspaceId);
  serverUrls.delete(workspaceId);
  serverTokens.delete(workspaceId);
  bootstrapPromises.delete(workspaceId);
  lastActivity.delete(workspaceId);
}

function isNotFound(error: unknown) {
  return error instanceof SandboxNotFoundError ||
    (error instanceof Error && /not found|does not exist/i.test(error.message));
}

async function isHealthy(baseUrl: string) {
  try {
    return (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3_000) })).ok;
  } catch {
    return false;
  }
}

function startHeartbeat(workspaceId: string, sandbox: E2BSandbox) {
  stopHeartbeat(workspaceId);
  const handle = setInterval(async () => {
    if (Date.now() - (lastActivity.get(workspaceId) ?? 0) > IDLE_RENEWAL_CUTOFF_MS) {
      stopHeartbeat(workspaceId);
      return;
    }
    try {
      await sandbox.setTimeout(INITIAL_TIMEOUT_MS);
    } catch {
      clearRuntimeState(workspaceId);
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeats.set(workspaceId, handle);
}

async function setStatus(workspaceId: string, sandboxStatus: SandboxStatus) {
  await db.update(workspaces).set({ sandboxStatus }).where(eq(workspaces.id, workspaceId));
}

export class SandboxManager {
  static async getOrCreate(workspaceId: string): Promise<E2BSandbox> {
    touchActivity(workspaceId);
    const cached = runningInstances.get(workspaceId);
    if (cached) {
      await cached.setTimeout(INITIAL_TIMEOUT_MS);
      return cached;
    }

    const inFlight = creatingPromises.get(workspaceId);
    if (inFlight) return inFlight;

    const promise = this.createOrConnect(workspaceId).finally(() => creatingPromises.delete(workspaceId));
    creatingPromises.set(workspaceId, promise);
    return promise;
  }

  private static async createOrConnect(workspaceId: string): Promise<E2BSandbox> {
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    await setStatus(workspaceId, "starting");
    try {
      let sandbox: E2BSandbox | undefined;
      if (workspace.sandboxId) {
        try {
          sandbox = await Sandbox.connect(workspace.sandboxId, {
            ...e2bOptions(),
            timeoutMs: INITIAL_TIMEOUT_MS,
          });
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }

      if (!sandbox) {
        sandbox = await Sandbox.create(sandboxTemplate(), {
          ...e2bOptions(),
          timeoutMs: INITIAL_TIMEOUT_MS,
          lifecycle: { onTimeout: "pause", autoResume: false },
          metadata: { workspaceId },
        });
      }

      await sandbox.setTimeout(INITIAL_TIMEOUT_MS);
      runningInstances.set(workspaceId, sandbox);
      startHeartbeat(workspaceId, sandbox);
      await db.update(workspaces).set({
        sandboxId: sandbox.sandboxId,
        sandboxStatus: "running",
      }).where(eq(workspaces.id, workspaceId));
      return sandbox;
    } catch (error) {
      await setStatus(workspaceId, "idle");
      throw error;
    }
  }

  static async ensureServerRunning(
    workspaceId: string,
    sandbox: E2BSandbox
  ): Promise<{ baseUrl: string; token: string }> {
    const cachedUrl = serverUrls.get(workspaceId);
    const cachedToken = serverTokens.get(workspaceId);
    if (cachedUrl && cachedToken && await isHealthy(cachedUrl)) {
      return { baseUrl: cachedUrl, token: cachedToken };
    }
    serverUrls.delete(workspaceId);
    serverTokens.delete(workspaceId);

    const [workspace] = await db.select({
      sandboxToken: workspaces.sandboxToken,
      sandboxUrl: workspaces.sandboxUrl,
    }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);

    if (workspace?.sandboxUrl && workspace.sandboxToken && await isHealthy(workspace.sandboxUrl)) {
      serverUrls.set(workspaceId, workspace.sandboxUrl);
      serverTokens.set(workspaceId, workspace.sandboxToken);
      return { baseUrl: workspace.sandboxUrl, token: workspace.sandboxToken };
    }

    const inFlight = bootstrapPromises.get(workspaceId);
    if (inFlight) return inFlight;

    const promise = bootstrapSandboxServer(sandbox).then(async ({ baseUrl, token }) => {
      serverUrls.set(workspaceId, baseUrl);
      serverTokens.set(workspaceId, token);
      await db.update(workspaces).set({ sandboxUrl: baseUrl, sandboxToken: token })
        .where(eq(workspaces.id, workspaceId));
      return { baseUrl, token };
    }).finally(() => bootstrapPromises.delete(workspaceId));
    bootstrapPromises.set(workspaceId, promise);
    return promise;
  }

  static async pause(workspaceId: string) {
    const [workspace] = await db.select({ sandboxId: workspaces.sandboxId })
      .from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!workspace?.sandboxId) {
      await setStatus(workspaceId, "idle");
      return;
    }

    const sandbox = runningInstances.get(workspaceId) ?? await Sandbox.connect(workspace.sandboxId, {
      ...e2bOptions(), timeoutMs: INITIAL_TIMEOUT_MS,
    });
    await sandbox.pause();
    clearRuntimeState(workspaceId);
    await setStatus(workspaceId, "paused");
  }

  /** Backward-compatible name for callers that still use the stop action. */
  static async stop(workspaceId: string) {
    await this.pause(workspaceId);
  }

  static async destroy(workspaceId: string) {
    const [workspace] = await db.select({ sandboxId: workspaces.sandboxId })
      .from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    clearRuntimeState(workspaceId);
    if (!workspace?.sandboxId) return;
    try {
      await Sandbox.kill(workspace.sandboxId, e2bOptions());
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  static getRunningInstance(workspaceId: string) {
    return runningInstances.get(workspaceId) ?? null;
  }

  static async ensureProjectDirectory(sandbox: E2BSandbox, relativePath: string) {
    await sandbox.files.makeDir(`/workspace/${relativePath}`);
  }

  static invalidate(workspaceId: string) {
    clearRuntimeState(workspaceId);
    db.update(workspaces).set({ sandboxToken: null, sandboxUrl: null })
      .where(eq(workspaces.id, workspaceId))
      .catch((error) => console.error("Failed to clear stale sandbox credentials:", error));
  }

  static async syncRemoteStatus(workspaceId: string): Promise<SandboxStatus> {
    const [workspace] = await db.select({
      sandboxId: workspaces.sandboxId,
      sandboxStatus: workspaces.sandboxStatus,
    }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);

    if (!workspace || workspace.sandboxStatus === "idle" || !workspace.sandboxId) return "idle";
    if (creatingPromises.has(workspaceId)) return workspace.sandboxStatus as SandboxStatus;

    const lastCheck = lastRemoteStatusCheck.get(workspaceId) ?? 0;
    if (Date.now() - lastCheck < MIN_REMOTE_STATUS_CHECK_INTERVAL_MS) {
      return workspace.sandboxStatus as SandboxStatus;
    }
    lastRemoteStatusCheck.set(workspaceId, Date.now());

    try {
      const info = await Sandbox.getInfo(workspace.sandboxId, e2bOptions());
      const sandboxStatus: SandboxStatus = info.state === "paused" ? "paused" : "running";
      if (sandboxStatus !== workspace.sandboxStatus) await setStatus(workspaceId, sandboxStatus);
      return sandboxStatus;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      clearRuntimeState(workspaceId);
      await db.update(workspaces).set({
        sandboxId: null,
        sandboxStatus: "idle",
        sandboxToken: null,
        sandboxUrl: null,
      }).where(eq(workspaces.id, workspaceId));
      return "idle";
    }
  }
}
