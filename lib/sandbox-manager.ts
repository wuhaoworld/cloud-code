import { bootstrapSandboxServer, restartServerIfStopped } from "./sandbox-setup";
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
// breathing room; we extend it to 30 minutes on every dialogue turn.
const INITIAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
// How often the heartbeat checks in and (if the workspace is still active)
// checks if the sandbox is still responsive.
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
// Stop checking once the workspace has had no activity for this long.
const IDLE_RENEWAL_CUTOFF_MS = 30 * 60 * 1000; // 30 minutes

// In-process cache: workspaceId → running Sandbox instance
// NOTE: This is per-process memory. In multi-instance deployments the sandbox
// must be looked up from DB (sandboxId) and reconnected via Sandbox.connect().
const runningInstances = new Map<string, InstanceType<typeof import("@vercel/sandbox").Sandbox>>();

// workspaceId → base URL of the in-sandbox HTTP server
const serverUrls = new Map<string, string>();

// workspaceId → bearer token for authenticating requests to the in-sandbox HTTP server.
// Stored alongside serverUrls so the caller can pass it with every /stream and /approve call.
const serverTokens = new Map<string, string>();

// workspaceId → in-flight bootstrap promise. Without this, concurrent calls
// to ensureServerRunning() for the same workspace (e.g. two near-simultaneous
// requests, or multiple serverless instances in production) would each see a
// cache miss and independently run `npm install` against the same
// node_modules directory in the sandbox, risking a corrupted/truncated
// native binary write.
const bootstrapPromises = new Map<string, Promise<{ baseUrl: string; token: string }>>();

// workspaceId → in-flight Sandbox.getOrCreate() promise. Creation (especially
// the very first `Sandbox.create` call plus onCreate bootstrap) can take a
// while, during which the named sandbox may not exist yet on Vercel's side.
// Without this map:
//   1. Concurrent getOrCreate() calls (e.g. the fire-and-forget call made
//      right after a workspace is inserted, plus a subsequent explicit
//      "start" request from the client) would race and could both attempt
//      to create the same named sandbox.
//   2. syncRemoteStatus() polling in parallel would call Sandbox.get() and
//      legitimately receive a 404 (the sandbox genuinely doesn't exist on
//      Vercel yet), incorrectly concluding the sandbox is "idle" and
//      clobbering the "starting" status while creation is still in flight.
const creatingPromises = new Map<
  string,
  Promise<InstanceType<typeof import("@vercel/sandbox").Sandbox>>
>();

// workspaceId → timestamp of last observed activity (chat request, etc).
const lastActivity = new Map<string, number>();

// workspaceId → timestamp of the last time we actually hit the Vercel
// Sandbox remote API from syncRemoteStatus(). The remote call is a real
// network round-trip (hundreds of ms to ~1s), so if multiple callers (e.g.
// several browser tabs, or the client polling loop plus a manual refresh)
// ask for the status within a short window, we just return the last known
// DB status instead of re-hitting the remote API every time.
const lastRemoteStatusCheck = new Map<string, number>();
const MIN_REMOTE_STATUS_CHECK_INTERVAL_MS = 3_000;

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

function isMaximumSandboxTimeoutError(err: unknown) {
  if (!(err instanceof Error)) return false;

  // The SDK's top-level message is only "Status code 400 is not ok". Its
  // parsed Vercel response body is exposed as `json`, where the useful code
  // and message live.
  const responseBody = (err as Error & { json?: unknown }).json;
  const responseError =
    responseBody && typeof responseBody === "object"
      ? (responseBody as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  const code = typeof responseError?.code === "string" ? responseError.code : "";
  const apiMessage =
    typeof responseError?.message === "string" ? responseError.message : "";

  return (
    (code === "sandbox_timeout_invalid" &&
      apiMessage.includes("maximum execution timeout")) ||
    err.message.includes("sandbox_timeout_invalid") ||
    err.message.includes("maximum execution timeout")
  );
}

/**
 * Periodically verify and renew the sandbox while the workspace is actively
 * in use. If the heartbeat fails, clean up local state.
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
      // A zero-duration extension is invalid. Renew to the same sliding
      // window used by dialogue turns; this is also a real liveness check.
      await ensureTargetTimeout(sandbox, INITIAL_TIMEOUT_MS);
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

/**
 * Ensure the sandbox session has at least `targetMs` remaining timeout.
 * If the current remaining time is less than `targetMs`, we extend it by the difference.
 *
 * Vercel imposes a plan-level maximum execution timeout (e.g. 1 hour on Pro).
 * If the requested extension would exceed that cap, the API returns a 400 with
 * code `sandbox_timeout_invalid`. We silently accept this — the sandbox is
 * already as long-lived as the plan allows.
 */
async function ensureTargetTimeout(
  sandbox: InstanceType<typeof import("@vercel/sandbox").Sandbox>,
  targetMs: number
) {
  try {
    const expiresAt = sandbox.expiresAt;
    if (expiresAt) {
      const remainingMs = expiresAt.getTime() - Date.now();
      if (remainingMs >= targetMs) {
        // Already has enough time remaining — nothing to do.
        return;
      }
      const extension = targetMs - remainingMs;
      await sandbox.extendTimeout(extension);
    } else {
      await sandbox.extendTimeout(targetMs);
    }
  } catch (err: unknown) {
    if (isMaximumSandboxTimeoutError(err)) {
      // The sandbox is already as long-lived as the plan permits.
      return;
    }
    throw err;
  }
}

export class SandboxManager {
  /**
   * Return a running Sandbox for the workspace, creating one if needed.
   *
   * Uses the SDK's `Sandbox.getOrCreate` which leverages persistent sandboxes:
   * - First call → creates a fresh sandbox, runs `onCreate` (full bootstrap)
   * - Subsequent calls → resumes from the latest auto-snapshot, runs `onResume`
   * - After timeout → Vercel auto-snapshots (persistent: true), next call
   *   resumes from that snapshot with node_modules intact — no reinstall needed
   */
  static async getOrCreate(workspaceId: string) {
    touchActivity(workspaceId);

    // Return cached in-process instance if still live
    const cached = runningInstances.get(workspaceId);
    if (cached) {
      // Sliding window renewal: ensure at least 30 minutes remaining on every dialogue turn
      await ensureTargetTimeout(cached, 30 * 60 * 1000);
      return cached;
    }

    // Deduplicate concurrent getOrCreate() calls for the same workspace —
    // e.g. the background call fired right after workspace insertion racing
    // with an explicit "start" request from the client.
    const inFlight = creatingPromises.get(workspaceId);
    if (inFlight) return inFlight;

    const promise = this.doGetOrCreate(workspaceId).finally(() => {
      creatingPromises.delete(workspaceId);
    });
    creatingPromises.set(workspaceId, promise);
    return promise;
  }

  private static async doGetOrCreate(workspaceId: string) {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    const Sandbox = await getSandboxClass();
    const credentials = getCredentials();

    try {
      await db
        .update(workspaces)
        .set({ sandboxStatus: "starting" })
        .where(eq(workspaces.id, workspaceId));

      // Use SDK's getOrCreate — handles both fresh creation and resume from snapshot.
      // persistent: true (default) means Vercel auto-snapshots on timeout,
      // and the sandbox resumes from the latest snapshot automatically.
      // keepLastSnapshots: { count: 1 } keeps storage costs flat.
      const sandbox = await Sandbox.getOrCreate({
        name: workspaceId,
        ...credentials,
        runtime: "node24",
        resources: { vcpus: 4 },
        timeout: INITIAL_TIMEOUT_MS,
        ports: [3001],
        keepLastSnapshots: { count: 1 },
        onCreate: async (sbx) => {
          // First time: full bootstrap (upload server, npm install, start server).
          // Store the result immediately so ensureServerRunning() finds a cache hit
          // and returns the correct token instead of re-bootstrapping with a new one.
          const { baseUrl, token } = await bootstrapSandboxServer(sbx);
          serverUrls.set(workspaceId, baseUrl);
          serverTokens.set(workspaceId, token);
        },
        onResume: async (sbx) => {
          // Resumed from snapshot: server process is dead but node_modules
          // are intact. Restart the server and cache the new token.
          const { baseUrl, token } = await restartServerIfStopped(sbx);
          serverUrls.set(workspaceId, baseUrl);
          serverTokens.set(workspaceId, token);
        },
      });

      // Ensure the sandbox timeout is extended to at least 30 minutes on successful startup/resume
      await ensureTargetTimeout(sandbox, 30 * 60 * 1000);

      runningInstances.set(workspaceId, sandbox);
      startHeartbeat(workspaceId, sandbox);

      const token = serverTokens.get(workspaceId);
      const url = serverUrls.get(workspaceId);
      const updateData: Partial<typeof workspaces.$inferInsert> = {
        sandboxId: sandbox.name,
        sandboxStatus: "running",
      };
      if (token) updateData.sandboxToken = token;
      if (url) updateData.sandboxUrl = url;

      await db
        .update(workspaces)
        .set(updateData)
        .where(eq(workspaces.id, workspaceId));

      return sandbox;
    } catch (err) {
      await db
        .update(workspaces)
        .set({ sandboxStatus: "idle", sandboxToken: null, sandboxUrl: null })
        .where(eq(workspaces.id, workspaceId));
      throw err;
    }
  }

  /**
   * Ensure the in-sandbox HTTP server is running. Returns the base URL and
   * the bearer token required to authenticate requests against it.
   * Uploads the server bundle, installs deps, and starts the server if needed.
   * Caches both values per workspace so re-calls are cheap.
   */
  static async ensureServerRunning(
    workspaceId: string,
    sandbox: InstanceType<typeof import("@vercel/sandbox").Sandbox>
  ): Promise<{ baseUrl: string; token: string }> {
    const cached = serverUrls.get(workspaceId);
    if (cached) {
      // Verify the cached server is still alive — after a sandbox
      // timeout + snapshot restore, the process is dead even though
      // we have a cached URL from before the timeout.
      try {
        const res = await fetch(`${cached}/health`, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) {
          const token = serverTokens.get(workspaceId) ?? "";
          return { baseUrl: cached, token };
        }
      } catch {
        // Server is dead — fall through to database check or re-bootstrap
      }
      serverUrls.delete(workspaceId);
      serverTokens.delete(workspaceId);
    }

    // Check database for existing token/url before bootstrapping
    try {
      const [workspace] = await db
        .select({
          sandboxToken: workspaces.sandboxToken,
          sandboxUrl: workspaces.sandboxUrl,
        })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

      if (workspace?.sandboxUrl && workspace?.sandboxToken) {
        const res = await fetch(`${workspace.sandboxUrl}/health`, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) {
          // Token is valid and server is running, cache in memory and return
          serverUrls.set(workspaceId, workspace.sandboxUrl);
          serverTokens.set(workspaceId, workspace.sandboxToken);
          return { baseUrl: workspace.sandboxUrl, token: workspace.sandboxToken };
        }
      }
    } catch (err) {
      console.error("Failed to query/ping persisted sandbox server credentials:", err);
    }

    // Deduplicate concurrent bootstrap calls for the same workspace so only
    // one `npm install` ever runs against the sandbox at a time.
    const inFlight = bootstrapPromises.get(workspaceId);
    if (inFlight) return inFlight;

    const promise = bootstrapSandboxServer(sandbox)
      .then(async ({ baseUrl, token }) => {
        serverUrls.set(workspaceId, baseUrl);
        serverTokens.set(workspaceId, token);
        // Persist the new credentials to the database
        await db
          .update(workspaces)
          .set({ sandboxToken: token, sandboxUrl: baseUrl })
          .where(eq(workspaces.id, workspaceId));
        return { baseUrl, token };
      })
      .finally(() => {
        bootstrapPromises.delete(workspaceId);
      });

    bootstrapPromises.set(workspaceId, promise);
    return promise;
  }

  /**
   * Take a filesystem snapshot so state survives sandbox shutdown.
   *
   * NOTE: sandbox.snapshot() stops the VM as a side effect. We clean up
   * in-memory state and set status to "idle" so the next getOrCreate() call
   * properly resumes from this snapshot.
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
      // snapshot() stops the sandbox — clean up stale in-memory references
      stopHeartbeat(workspaceId);
      runningInstances.delete(workspaceId);
      serverUrls.delete(workspaceId);
      serverTokens.delete(workspaceId);
      bootstrapPromises.delete(workspaceId);
      await db
        .update(workspaces)
        .set({
          sandboxSnapshotId: snap.snapshotId,
          sandboxStatus: "idle",
          sandboxToken: null,
          sandboxUrl: null,
        })
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
    serverTokens.delete(workspaceId);
    bootstrapPromises.delete(workspaceId);
    await sandbox.stop();

    await db
      .update(workspaces)
      .set({
        sandboxId: null,
        sandboxStatus: "idle",
        sandboxToken: null,
        sandboxUrl: null,
      })
      .where(eq(workspaces.id, workspaceId));
  }

  static getRunningInstance(workspaceId: string) {
    return runningInstances.get(workspaceId) ?? null;
  }

  /**
   * Create the sandbox-side directory backing a project, if it doesn't
   * already exist. `mkdir -p` is idempotent, so this is safe to call
   * every time a project is created and again defensively before every
   * chat request — cheap, and it guarantees the directory is there even if
   * the sandbox was recreated from a snapshot that predates the project,
   * or the background creation triggered at project-creation time hasn't
   * finished yet.
   *
   * `relativePath` is the project's `path` column (e.g. "my-app"), which
   * lives under `/workspace/<path>` inside the sandbox.
   */
  static async ensureProjectDirectory(
    sandbox: InstanceType<typeof import("@vercel/sandbox").Sandbox>,
    relativePath: string
  ): Promise<void> {
    await sandbox.runCommand({
      cmd: "mkdir",
      args: ["-p", `/workspace/${relativePath}`],
    });
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
    serverTokens.delete(workspaceId);
    bootstrapPromises.delete(workspaceId);
    db.update(workspaces)
      .set({ sandboxToken: null, sandboxUrl: null })
      .where(eq(workspaces.id, workspaceId))
      .catch((err) => console.error("Failed to clear sandbox db state during invalidate:", err));
  }

  /**
   * Checks the actual status of the sandbox remotely and syncs it to the database if it has changed.
   * Only does remote check if the database status indicates it is active (starting, running, snapshotting).
   */
  static async syncRemoteStatus(workspaceId: string): Promise<string> {
    const [workspace] = await db
      .select({
        id: workspaces.id,
        sandboxStatus: workspaces.sandboxStatus,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!workspace) return "idle";

    // If already marked as idle locally, we don't need to do a remote check.
    if (workspace.sandboxStatus === "idle") {
      return "idle";
    }

    // A getOrCreate() is currently in flight for this workspace (e.g. the
    // background creation kicked off right after the workspace row was
    // inserted). The named sandbox may not exist on Vercel's side yet, so a
    // remote check here would race and could spuriously 404 even though
    // creation is proceeding normally. Trust the local "starting" status
    // and skip the remote check until creation settles.
    if (creatingPromises.has(workspaceId)) {
      return workspace.sandboxStatus;
    }

    // Throttle: skip the remote round-trip if we checked very recently.
    // Callers (polling UI, multiple tabs, etc.) get the last known DB status
    // instead of paying for another ~1s Vercel API call every time.
    const lastCheck = lastRemoteStatusCheck.get(workspaceId) ?? 0;
    if (Date.now() - lastCheck < MIN_REMOTE_STATUS_CHECK_INTERVAL_MS) {
      return workspace.sandboxStatus;
    }
    lastRemoteStatusCheck.set(workspaceId, Date.now());

    try {
      const Sandbox = await getSandboxClass();
      const credentials = getCredentials();

      const remoteSandbox = await Sandbox.get({
        name: workspaceId,
        resume: false,
        ...credentials,
      });

      const remoteSandboxData = remoteSandbox as unknown as { sandbox?: { status?: string } };
      const remoteStatus = remoteSandboxData.sandbox?.status;

      let mappedStatus: SandboxStatus = "idle";
      if (remoteStatus === "running") {
        mappedStatus = "running";
      } else if (remoteStatus === "pending") {
        mappedStatus = "starting";
      } else if (remoteStatus === "snapshotting" || remoteStatus === "stopping") {
        mappedStatus = "snapshotting";
      } else {
        mappedStatus = "idle";
      }

      if (mappedStatus !== workspace.sandboxStatus) {
        await db
          .update(workspaces)
          .set({ sandboxStatus: mappedStatus })
          .where(eq(workspaces.id, workspaceId));

        if (mappedStatus === "idle") {
          this.invalidate(workspaceId);
        }
      }

      return mappedStatus;
    } catch (err) {
      console.error(`Failed to verify sandbox remote status for workspace ${workspaceId}:`, err);
      // If we got a 404 or any error checking the remote status, it means it is not running
      await db
        .update(workspaces)
        .set({ sandboxStatus: "idle" })
        .where(eq(workspaces.id, workspaceId));
      this.invalidate(workspaceId);
      return "idle";
    }
  }
}

