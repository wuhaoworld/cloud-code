import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  addSessionPermissionUpdates,
  createSessionPermissionUpdate,
  pendingPermissions,
} from "@/lib/pending-permissions";
import { pendingSandboxApprovals } from "@/lib/sandbox-approvals";

// POST /api/chat/approve — 用户审批挂起的权限请求
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { requestId, action, workspaceId } = body as {
    requestId: string;
    action: string;
    workspaceId?: string;
  };

  if (!requestId || !action) {
    return NextResponse.json(
      { error: "requestId and action are required" },
      { status: 400 }
    );
  }

  // Strictly validate the action enum to prevent unexpected values from
  // being silently treated as "allow" in the sandbox branch below.
  const VALID_ACTIONS = ["approve", "approve_permanent", "deny"] as const;
  type ValidAction = typeof VALID_ACTIONS[number];
  if (!(VALID_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      { error: "Invalid action. Must be one of: approve, approve_permanent, deny" },
      { status: 400 }
    );
  }
  const validatedAction = action as ValidAction;

  // ── Sandbox path: forward decision to the in-sandbox HTTP server ──────────
  let sandboxBaseUrl = "";
  let sandboxToken = "";

  if (workspaceId) {
    // 1. Verify workspace ownership and retrieve credentials from DB
    const [workspace] = await db
      .select({
        userId: workspaces.userId,
        sandboxToken: workspaces.sandboxToken,
        sandboxUrl: workspaces.sandboxUrl,
      })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id)))
      .limit(1);

    if (workspace) {
      if (workspace.sandboxUrl && workspace.sandboxToken) {
        sandboxBaseUrl = workspace.sandboxUrl;
        sandboxToken = workspace.sandboxToken;
      }
    } else {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
    }
  }

  // Fallback to in-memory registration if not resolved via workspaceId
  const sandboxEntry = pendingSandboxApprovals.get(requestId);
  if (sandboxEntry && !sandboxBaseUrl) {
    // IDOR check: only the user who owns the session may approve/deny it.
    if (sandboxEntry.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    sandboxBaseUrl = sandboxEntry.sandboxBaseUrl;
    sandboxToken = sandboxEntry.token;
    pendingSandboxApprovals.delete(requestId);
  }

  if (sandboxBaseUrl) {
    const behavior = validatedAction === "deny" ? "deny" : "allow";
    try {
      await fetch(`${sandboxBaseUrl}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sandboxToken ? { Authorization: `Bearer ${sandboxToken}` } : {}),
        },
        body: JSON.stringify({
          requestId,
          behavior,
          message: validatedAction === "deny" ? "Permission denied by user." : undefined,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to forward decision to sandbox";
      return NextResponse.json({ error: message }, { status: 502 });
    }
    return NextResponse.json({ success: true, behavior });
  }

  // ── Local (direct) path ────────────────────────────────────────────────────
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    return NextResponse.json(
      { error: "Permission request not found or already resolved" },
      { status: 404 }
    );
  }

  // IDOR check: sessionPermissionKey is "userId:projectId:sessionId".
  // The leading segment must match the authenticated user.
  const keyUserId = pending.sessionPermissionKey?.split(":")[0];
  if (keyUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  pendingPermissions.delete(requestId);
  clearTimeout(pending.timeout);
  const fallbackPermissionUpdate = createSessionPermissionUpdate(
    pending.toolName,
    pending.input
  );
  const updatedPermissions =
    validatedAction === "approve_permanent"
      ? [
          ...(pending.suggestions ?? []),
          ...(fallbackPermissionUpdate ? [fallbackPermissionUpdate] : []),
        ]
      : undefined;

  addSessionPermissionUpdates(pending.sessionPermissionKey, updatedPermissions);
  pending.resolve(
    validatedAction === "approve" || validatedAction === "approve_permanent"
      ? {
          behavior: "allow",
          updatedInput: pending.input,
          updatedPermissions,
        }
      : { behavior: "deny", message: "Permission denied by user." }
  );

  return NextResponse.json({
    success: true,
    behavior: validatedAction === "deny" ? "deny" : "allow",
  });
}
