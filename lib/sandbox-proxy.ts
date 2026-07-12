/**
 * SSE proxy layer for sandbox-based streaming.
 *
 * Instead of running claude-agent-sdk in the Next.js process, we forward the
 * request to the in-sandbox HTTP server, re-stream SSE events, and handle the
 * permission_request ↔ approve round-trip.
 *
 * The sandbox server emits:
 *   sdk_message   — raw SDK message object (we expand it to individual events)
 *   permission_request / permission_resolved — forwarded as-is
 *   error         — forwarded as-is
 *
 * This module processes sdk_message events and re-emits the same fine-grained
 * events (session_init, text_delta, tool_start, tool_end, done, …) that the
 * non-sandbox stream route emits, keeping the client protocol identical.
 */

import { pendingSandboxApprovals, registerSandboxApproval } from "./sandbox-approvals";
import type { Block } from "@/store/types";

// Re-export so the stream route has a single import point
export { pendingSandboxApprovals } from "./sandbox-approvals";

export interface SandboxStreamOptions {
  sandboxBaseUrl: string;
  projectId: string;
  prompt: string;
  cwd: string;
  sessionId?: string;
  model?: string;
  permissionMode?: string;
  userMsgId: string;
  assistantMsgId: string;
  workspaceId: string;
}

type EmitFn = (eventType: string, data: Record<string, unknown>) => void;

/**
 * Stream a claude-agent-sdk query from the sandbox server, forwarding all events
 * to the browser via the provided `emit` function.
 *
 * The caller is responsible for:
 *   - constructing the ReadableStream / Response
 *   - persisting messages to the DB (done returns sessionId + cost)
 */
export async function sandboxStreamProxy(
  opts: SandboxStreamOptions,
  emit: EmitFn,
  signal: AbortSignal
): Promise<{ sessionId: string | undefined; assistantBlocks: Block[] }> {
  const {
    sandboxBaseUrl,
    prompt,
    cwd,
    sessionId,
    model,
    permissionMode,
    workspaceId,
  } = opts;

  const res = await fetch(`${sandboxBaseUrl}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, cwd, sessionId, model, permissionMode }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sandbox server error ${res.status}: ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Sandbox server returned no body");

  const decoder = new TextDecoder();
  let buffer = "";
  let finalSessionId: string | undefined = sessionId;

  // Per-message state (mirrors the non-sandbox stream route logic)
  let assistantMsgId = opts.assistantMsgId;
  const toolTimers = new Map<string, number>();
  let thinkingStartMs = 0;
  let assistantBlocks: Block[] = [];

  const parseChunk = (chunk: string): { eventType: string; data: Record<string, unknown> } | null => {
    const lines = chunk.split("\n");
    let eventType = "message";
    let dataLine = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) eventType = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLine = line.slice(6).trim();
    }
    if (!dataLine) return null;
    try { return { eventType, data: JSON.parse(dataLine) }; } catch { return null; }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const parsed = parseChunk(chunk);
      if (!parsed) continue;

      const { eventType, data } = parsed;

      if (eventType === "permission_request") {
        // Add workspaceId so the approve route knows which sandbox to forward to
        emit("permission_request", { ...data, workspaceId });
        // Register pending so approve route can call us back (auto-evicted after
        // 10 minutes to prevent leaks from abandoned/timed-out requests).
        registerSandboxApproval(data.requestId as string, {
          sandboxBaseUrl,
          workspaceId,
        });
        continue;
      }

      if (eventType === "permission_resolved") {
        emit("permission_resolved", data);
        continue;
      }

      if (eventType === "error") {
        emit("error", data);
        continue;
      }

      if (eventType === "sdk_message") {
        // Expand the raw SDK message into fine-grained events
        const msg = data.message as { type: string; [k: string]: unknown };
        const r = processSDKMessage(msg, assistantMsgId, toolTimers, assistantBlocks, thinkingStartMs, emit);
        assistantMsgId = r.assistantMsgId;
        assistantBlocks = r.assistantBlocks;
        thinkingStartMs = r.thinkingStartMs;
        if (r.sessionId) finalSessionId = r.sessionId;
        if (r.done) {
          // No further messages after result
        }
      }
    }
  }

  return { sessionId: finalSessionId, assistantBlocks };
}

// ---------------------------------------------------------------------------
// SDK message expansion (mirrors stream/route.ts logic)
// ---------------------------------------------------------------------------

interface ProcessResult {
  assistantMsgId: string;
  assistantBlocks: Block[];
  thinkingStartMs: number;
  sessionId?: string;
  done?: boolean;
}

function processSDKMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any,
  assistantMsgId: string,
  toolTimers: Map<string, number>,
  assistantBlocks: Block[],
  thinkingStartMs: number,
  emit: EmitFn
): ProcessResult {
  const msgType = message.type as string;

  if (msgType === "system" && message.subtype === "init") {
    if (message.session_id) {
      emit("session_init", { sessionId: message.session_id, cwd: message.cwd });
      return { assistantMsgId, assistantBlocks, thinkingStartMs, sessionId: message.session_id as string };
    }
  }

  if (msgType === "stream_event") {
    const event = message.event;
    if (!event) return { assistantMsgId, assistantBlocks, thinkingStartMs };

    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block?.type === "thinking") {
        thinkingStartMs = Date.now();
        assistantBlocks.push({ type: "thinking", text: "" });
      } else if (block?.type === "text") {
        assistantBlocks.push({ type: "text", text: "" });
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta;
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        const last = assistantBlocks[assistantBlocks.length - 1];
        if (last?.type === "thinking") {
          last.text = (last.text ?? "") + delta.thinking;
          emit("thinking_delta", { msgId: assistantMsgId, delta: delta.thinking });
        }
      } else if (delta?.type === "text_delta" && typeof delta.text === "string") {
        const last = assistantBlocks[assistantBlocks.length - 1];
        if (last?.type === "text") {
          last.text = (last.text ?? "") + delta.text;
          emit("text_delta", { msgId: assistantMsgId, delta: delta.text });
        }
      }
    } else if (event.type === "content_block_stop") {
      const last = assistantBlocks[assistantBlocks.length - 1];
      if (last?.type === "thinking" && thinkingStartMs > 0) {
        const durationSeconds = (Date.now() - thinkingStartMs) / 1000;
        last.durationSeconds = durationSeconds;
        emit("thinking_done", { msgId: assistantMsgId, durationSeconds });
        thinkingStartMs = 0;
      }
    }
  }

  if (msgType === "assistant") {
    const content = message.message?.content || [];
    for (const block of content) {
      if (block.type === "tool_use") {
        const toolUseId: string = block.id;
        toolTimers.set(toolUseId, Date.now());
        assistantBlocks.push({
          type: "tool_use",
          toolUseId,
          toolName: block.name,
          input: block.input || {},
          status: "running",
        });
        emit("tool_start", { msgId: assistantMsgId, toolUseId, toolName: block.name, input: block.input || {} });
      }
    }
  }

  if (msgType === "user") {
    const msgContent = message.message?.content || [];
    for (const block of msgContent) {
      if (block.type === "tool_result") {
        const toolUseId: string = block.tool_use_id;
        const durationMs = Date.now() - (toolTimers.get(toolUseId) ?? Date.now());
        toolTimers.delete(toolUseId);
        const output =
          typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
            ? block.content.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n")
            : "";
        const isError = block.is_error ?? false;
        const b = assistantBlocks.find((x): x is import("@/store/types").ToolUseBlock => x.type === "tool_use" && x.toolUseId === toolUseId);
        if (b) { b.output = output; b.isError = isError; b.status = isError ? "error" : "done"; b.durationMs = durationMs; }
        emit("tool_end", { msgId: assistantMsgId, toolUseId, output, isError, durationMs });
      }
    }
  }

  if (msgType === "result") {
    const finalSessionId = message.session_id as string | undefined;
    emit("done", { sessionId: finalSessionId, costUsd: message.cost_usd, durationMs: message.duration_ms });
    return { assistantMsgId, assistantBlocks, thinkingStartMs, sessionId: finalSessionId, done: true };
  }

  return { assistantMsgId, assistantBlocks, thinkingStartMs };
}
