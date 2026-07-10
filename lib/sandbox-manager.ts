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

    await db
      .update(workspaces)
      .set({ sandboxStatus: "starting" })
      .where(eq(workspaces.id, workspaceId));

    const Sandbox = await getSandboxClass();
    const credentials = getCredentials();

    let sandbox: InstanceType<typeof Sandbox>;

    if (workspace.sandboxSnapshotId) {
      sandbox = await Sandbox.create({
        ...credentials,
        source: { type: "snapshot", snapshotId: workspace.sandboxSnapshotId },
        timeout: 300_000,
      });
    } else {
      sandbox = await Sandbox.create({
        ...credentials,
        runtime: "node24",
        timeout: 300_000,
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
   * Assumes the server bundle is already present in the snapshot; if not,
   * Phase 2 will add the full bootstrap logic here.
   */
  static async ensureServerRunning(
    workspaceId: string,
    sandbox: InstanceType<typeof import("@vercel/sandbox").Sandbox>
  ): Promise<string> {
    // Phase 2 will install deps and start the express server here.
    // domain(port) returns the sandbox's public HTTPS tunnel URL for that port.
    return sandbox.domain(3001);
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
