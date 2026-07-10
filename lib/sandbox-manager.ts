import { bootstrapSandboxServer } from "./sandbox-setup";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";

export type SandboxStatus = "idle" | "starting" | "running" | "snapshotting";

// lazy import — @vercel/sandbox may not be installed yet
async function getSandboxClass() {
  const mod = await import("@vercel/sandbox");
  return mod.Sandbox as typeof import("@vercel/sandbox").Sandbox;
}

function getCredentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  if (VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID) {
    return { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID };
  }
  return {};
}

// Vercel Sandbox's own default lifetime is 5 minutes, which is too short:
// bootstrapping the in-sandbox server alone (npm install of the ~250MB
// claude native binary) can take 1-3 minutes, leaving almost no time for the
// first chat turn before the VM is auto-stopped. Start it with more
// breathing room; the heartbeat below keeps extending it during real usage.
const INITIAL_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
// How often the heartbeat checks in and (if the workspace is still active)
// extends the sandbox's timeout.
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
// How much to extend the timeout by on each heartbeat tick.
const HEARTBEAT_EXTEND_MS = 20 * 60 * 1000; // 20 minutes
// Stop renewing (and let Vercel's own timeout stop the VM) once the
// workspace has had no activity for this long, so unused sandboxes don't
// run — and bill — forever.
const IDLE_RENEWAL_CUTOFF_MS = 15 * 60 * 1000; // 15 minutes

// In-process cache: workspaceId → running Sandbox instance
// NOTE: This is per-process memory. In multi-instance deployments the sandbox
// must be looked up from DB (sandboxId) and reconnected via Sandbox.connect().
const runningInstances = new Map<string, InstanceType<typeof import("@vercel/sandbox").Sandbox>>();

// workspaceId → base URL of the in-sandbox HTTP server
const serverUrls = new Map<string, string>();

// workspaceId → in-flight bootstrap promise. Without this, concurrent calls
// to ensureServerRunning() for the same workspace (e.g. two near-simultaneous
// requests, or multiple serverless instances in production) would each see a
// cache miss and independently run `npm install` against the same
// node_modules directory in the sandbox, risking a corrupted/truncated
// native binary write.
const bootstrapPromises = new Map<string, Promise<string>>();

// workspaceId → timestamp of last observed activity (chat request, etc).
const lastActivity = new Map<string, number>();

// workspaceId → heartbeat interval handle that periodically extends the
// sandbox's timeout while the workspace is actively in use.
const heartbeats = new Map<string, ReturnType<typeof setInterval>>();

function touchActivity(workspaceId: string) {
  lastActivity.set(workspaceId, Date.now());
}

function stopHeartbeat(workspaceId: string) {
  const handle = heartbeats.get(workspaceId);
  if (handle) {
    clearInterval(handle);
    heartbeats.delete(workspaceId);
  }
}

/**
 * Keep extending the sandbox's timeout on a fixed interval as long as the
 * workspace has had recent activity. Once activity goes stale (the user
 * stopped chatting), we stop renewing so the sandbox naturally auto-stops
 * per Vercel's own timeout instead of running indefinitely.
 */
function startHeartbeat(
  workspaceId: string,
  sandbox: InstanceType<typeof import("@vercel/sandbox").Sandbox>
) {
  stopHeartbeat(workspaceId);
  const handle = setInterval(async () => {
    const last = lastActivity.get(workspaceId) ?? 0;
    if (Date.now() - last > IDLE_RENEWAL_CUTOFF_MS) {
      // No recent activity — stop renewing and let it expire naturally.
      stopHeartbeat(workspaceId);
      return;
    }
    try {
      await sandbox.extendTimeout(HEARTBEAT_EXTEND_MS);
    } catch {
      // Sandbox is likely already gone (stopped/deleted) — clean up local
      // state so the next request falls through to recreate/reconnect
      // instead of reusing a dead reference.
      stopHeartbeat(workspaceId);
      runningInstances.delete(workspaceId);
      serverUrls.delete(workspaceId);
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeats.set(workspaceId, handle);
}

export class SandboxManager {
  /**
   * Return a running Sandbox for the workspace, creating one if needed.
   * Restores from snapshot when available.
   */
  static async getOrCreate(workspaceId: string) {
    touchActivity(workspaceId);

    // Return cached in-process instance if still live
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

    // If DB says there's already a running sandbox (e.g. process restarted / hot-reload),
    // try to reconnect to it by name instead of creating a new one.
    if (workspace.sandboxStatus === "running" && workspace.sandboxId) {
      try {
        sandbox = await Sandbox.get({ name: workspace.sandboxId, ...credentials });
        // Extend immediately on reconnect in case it's close to expiring,
        // then keep it alive for as long as the workspace stays active.
        await sandbox.extendTimeout(INITIAL_TIMEOUT_MS).catch(() => {});
        runningInstances.set(workspaceId, sandbox);
        startHeartbeat(workspaceId, sandbox);
        return sandbox;
      } catch {
        // Sandbox is gone (timed out, deleted) — fall through to create a new one
        await db
          .update(workspaces)
          .set({ sandboxId: null, sandboxStatus: "idle" })
          .where(eq(workspaces.id, workspaceId));
      }
    }

    await db
      .update(workspaces)
      .set({ sandboxStatus: "starting" })
      .where(eq(workspaces.id, workspaceId));

    if (workspace.sandboxSnapshotId) {
      sandbox = await Sandbox.create({
        ...credentials,
        source: { type: "snapshot", snapshotId: workspace.sandboxSnapshotId },
        timeout: INITIAL_TIMEOUT_MS,
        ports: [3001],
      });
    } else {
      sandbox = await Sandbox.create({
        ...credentials,
        runtime: "node24",
        timeout: INITIAL_TIMEOUT_MS,
        ports: [3001],
      });
    }

    runningInstances.set(workspaceId, sandbox);
    startHeartbeat(workspaceId, sandbox);

    await db
      .update(workspaces)
      .set({ sandboxId: sandbox.name, sandboxStatus: "running" })
      .where(eq(workspaces.id, workspaceId));

    return sandbox;
  }

  /**
   * Ensure the in-sandbox HTTP server is running. Returns the base URL.
   * Uploads the server bundle, installs deps, and starts the server if needed.
   * Caches the base URL per workspace so re-calls are cheap.
   */
  static async ensureServerRunning(
    workspaceId: string,
    sandbox: InstanceType<typeof import("@vercel/sandbox").Sandbox>
  ): Promise<string> {
    const cached = serverUrls.get(workspaceId);
    if (cached) return cached;

    // Deduplicate concurrent bootstrap calls for the same workspace so only
    // one `npm install` ever runs against the sandbox at a time.
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

  /**
   * Take a filesystem snapshot so state survives sandbox shutdown.
   */
  static async checkpoint(workspaceId: string) {
    const sandbox = runningInstances.get(workspaceId);
    if (!sandbox) return;

    await db
      .update(workspaces)
      .set({ sandboxStatus: "snapshotting" })
      .where(eq(workspaces.id, workspaceId));

    try {
      const snap = await sandbox.snapshot();
      await db
        .update(workspaces)
        .set({ sandboxSnapshotId: snap.snapshotId, sandboxStatus: "running" })
        .where(eq(workspaces.id, workspaceId));
    } catch (err) {
      await db
        .update(workspaces)
        .set({ sandboxStatus: "running" })
        .where(eq(workspaces.id, workspaceId));
      throw err;
    }
  }

  /**
   * Stop the sandbox and update DB status.
   */
  static async stop(workspaceId: string) {
    const sandbox = runningInstances.get(workspaceId);
    if (!sandbox) return;

    stopHeartbeat(workspaceId);
    lastActivity.delete(workspaceId);
    runningInstances.delete(workspaceId);
    serverUrls.delete(workspaceId);
    bootstrapPromises.delete(workspaceId);
    await sandbox.stop();

    await db
      .update(workspaces)
      .set({ sandboxId: null, sandboxStatus: "idle" })
      .where(eq(workspaces.id, workspaceId));
  }

  static getRunningInstance(workspaceId: string) {
    return runningInstances.get(workspaceId) ?? null;
  }

  /**
   * Drop cached local state for a workspace's sandbox without calling
   * sandbox.stop(). Used when a request discovers the cached instance is
   * actually dead server-side (e.g. a 410 from the sandbox's HTTP server),
   * so the next getOrCreate() call reconnects/recreates instead of reusing
   * a stale reference.
   */
  static invalidate(workspaceId: string) {
    stopHeartbeat(workspaceId);
    runningInstances.delete(workspaceId);
    serverUrls.delete(workspaceId);
    bootstrapPromises.delete(workspaceId);
  }
}
