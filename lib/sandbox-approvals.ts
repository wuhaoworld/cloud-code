/**
 * Shared in-memory registry for sandbox-mode permission approvals.
 *
 * When the sandbox server emits a permission_request, the proxy registers an
 * entry here so the /api/chat/approve route can forward the user's decision
 * to the correct sandbox VM.
 */
export interface SandboxApprovalEntry {
  sandboxBaseUrl: string;
  workspaceId: string;
}

// requestId → sandbox connection info
export const pendingSandboxApprovals = new Map<string, SandboxApprovalEntry>();
