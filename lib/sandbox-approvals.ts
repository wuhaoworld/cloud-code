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

// Auto-evict after 10 minutes so abandoned requests (stream abort, sandbox
// timeout, user ignoring the prompt) don't accumulate indefinitely.
const APPROVAL_TTL_MS = 10 * 60 * 1000;

export function registerSandboxApproval(
  requestId: string,
  entry: SandboxApprovalEntry
): void {
  pendingSandboxApprovals.set(requestId, entry);
  setTimeout(() => {
    pendingSandboxApprovals.delete(requestId);
  }, APPROVAL_TTL_MS);
}
