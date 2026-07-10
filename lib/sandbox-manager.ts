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

export class SandboxManager {
  /**
   * Return a running Sandbox for the workspace, creating one if needed.
   * Restores from snapshot when available.
   */
  static async getOrCreate(workspaceId: string) {
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
        runningInstances.set(workspaceId, sandbox);
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
        timeout: 300_000,
        ports: [3001],
      });
    } else {
      sandbox = await Sandbox.create({
        ...credentials,
        runtime: "node24",
        timeout: 300_000,
        ports: [3001],
      });
    }

    runningInstances.set(workspaceId, sandbox);

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
}
