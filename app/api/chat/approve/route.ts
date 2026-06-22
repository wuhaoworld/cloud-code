import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  addSessionPermissionUpdates,
  createSessionPermissionUpdate,
  pendingPermissions,
} from "@/lib/pending-permissions";

// POST /api/chat/approve — 用户审批挂起的权限请求
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { requestId, action } = body as {
    requestId: string;
    action: "approve" | "approve_permanent" | "deny";
  };

  if (!requestId || !action) {
    return NextResponse.json(
      { error: "requestId and action are required" },
      { status: 400 }
    );
  }

  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    return NextResponse.json(
      { error: "Permission request not found or already resolved" },
      { status: 404 }
    );
  }

  pendingPermissions.delete(requestId);
  clearTimeout(pending.timeout);
  const fallbackPermissionUpdate = createSessionPermissionUpdate(
    pending.toolName,
    pending.input
  );
  const updatedPermissions =
    action === "approve_permanent"
      ? [
          ...(pending.suggestions ?? []),
          ...(fallbackPermissionUpdate ? [fallbackPermissionUpdate] : []),
        ]
      : undefined;

  addSessionPermissionUpdates(pending.sessionPermissionKey, updatedPermissions);
  pending.resolve(
    action === "approve" || action === "approve_permanent"
      ? {
          behavior: "allow",
          updatedInput: pending.input,
          updatedPermissions,
        }
      : { behavior: "deny", message: "Permission denied by user." }
  );

  return NextResponse.json({
    success: true,
    behavior: action === "deny" ? "deny" : "allow",
  });
}
