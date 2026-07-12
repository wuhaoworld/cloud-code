import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
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
  const { requestId, action } = body as {
    requestId: string;
    action: string;
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
  const sandboxEntry = pendingSandboxApprovals.get(requestId);
  if (sandboxEntry) {
    // IDOR check: only the user who owns the session may approve/deny it.
    if (sandboxEntry.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    pendingSandboxApprovals.delete(requestId);
    const behavior = validatedAction === "deny" ? "deny" : "allow";
    try {
      await fetch(`${sandboxEntry.sandboxBaseUrl}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
