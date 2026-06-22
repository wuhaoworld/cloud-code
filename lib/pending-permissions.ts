import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

export type PendingPermissionDecision =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
    }
  | { behavior: "deny"; message: string };

export interface PendingPermissionRequest {
  resolve: (value: PendingPermissionDecision) => void;
  timeout: ReturnType<typeof setTimeout>;
  toolName: string;
  input: Record<string, unknown>;
  toolUseID: string;
  suggestions?: PermissionUpdate[];
}

export const pendingPermissions = new Map<string, PendingPermissionRequest>();

export function toPermissionResult(
  decision: PendingPermissionDecision,
  toolUseID: string,
  originalInput: Record<string, unknown>
): PermissionResult {
  if (decision.behavior === "allow") {
    return {
      behavior: "allow",
      toolUseID,
      updatedInput: decision.updatedInput ?? originalInput,
      updatedPermissions: decision.updatedPermissions,
      decisionClassification: decision.updatedPermissions
        ? "user_permanent"
        : "user_temporary",
    };
  }

  return {
    behavior: "deny",
    toolUseID,
    message: decision.message,
    decisionClassification: "user_reject",
  };
}
