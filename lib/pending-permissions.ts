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
  sessionPermissionKey?: string;
  suggestions?: PermissionUpdate[];
}

export const pendingPermissions = new Map<string, PendingPermissionRequest>();

const sessionPermissionUpdates = new Map<string, PermissionUpdate[]>();

function getRuleContent(toolName: string, input: Record<string, unknown>) {
  if (toolName === "Bash" && typeof input.command === "string") {
    return input.command.trim().split(/\s+/)[0];
  }

  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.path === "string") return input.path;
  return undefined;
}

export function createSessionPermissionUpdate(
  toolName: string,
  input: Record<string, unknown>
): PermissionUpdate | undefined {
  const ruleContent = getRuleContent(toolName, input);
  if (!ruleContent) return undefined;

  return {
    type: "addRules",
    behavior: "allow",
    destination: "session",
    rules: [{ toolName, ruleContent }],
  };
}

function getRuleInputValue(toolName: string, input: Record<string, unknown>) {
  if (toolName === "Bash" && typeof input.command === "string") {
    return input.command.trim();
  }

  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.path === "string") return input.path;
  return JSON.stringify(input);
}

function ruleMatches(
  rule: { toolName: string; ruleContent?: string },
  toolName: string,
  input: Record<string, unknown>
) {
  if (rule.toolName !== toolName) return false;
  if (!rule.ruleContent) return true;

  const value = getRuleInputValue(toolName, input);
  return value === rule.ruleContent || value.startsWith(rule.ruleContent);
}

export function addSessionPermissionUpdates(
  sessionPermissionKey: string | undefined,
  updates: PermissionUpdate[] | undefined
) {
  if (!sessionPermissionKey || !updates?.length) return;

  const existing = sessionPermissionUpdates.get(sessionPermissionKey) ?? [];
  sessionPermissionUpdates.set(sessionPermissionKey, [...existing, ...updates]);
}

export function getAllowedSessionPermissionUpdates(
  sessionPermissionKey: string | undefined,
  toolName: string,
  input: Record<string, unknown>
) {
  if (!sessionPermissionKey) return undefined;

  const updates = sessionPermissionUpdates.get(sessionPermissionKey);
  if (!updates?.length) return undefined;

  return updates.filter(
    (update) =>
      (update.type === "addRules" || update.type === "replaceRules") &&
      update.behavior === "allow" &&
      update.rules.some((rule) => ruleMatches(rule, toolName, input))
  );
}

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
