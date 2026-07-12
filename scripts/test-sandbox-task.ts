/**
 * 测试脚本：模拟用户提交任务到 Sandbox，打印完整的 SSE 返回内容。
 *
 * 用法:
 *   npx tsx scripts/test-sandbox-task.ts --workspace <workspaceId> [--prompt "your prompt"]
 *
 * 示例:
 *   npx tsx scripts/test-sandbox-task.ts --workspace abc123
 *   npx tsx scripts/test-sandbox-task.ts --workspace abc123 --prompt "列出当前目录下的文件"
 *
 * 环境变量 (从 .env 加载):
 *   DB_FILE_NAME, VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID
 */

import "dotenv/config";
import { db } from "../db";
import { workspaces, projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { SandboxManager } from "../lib/sandbox-manager";

// ── 解析命令行参数 ────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: { workspaceId?: string; prompt?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace" && args[i + 1]) {
      parsed.workspaceId = args[++i];
    } else if (args[i] === "--prompt" && args[i + 1]) {
      parsed.prompt = args[++i];
    }
  }

  if (!parsed.workspaceId) {
    console.error("用法: npx tsx scripts/test-sandbox-task.ts --workspace <workspaceId> [--prompt \"...\"]");
    process.exit(1);
  }

  parsed.prompt ??= "请列出当前工作目录下的所有文件（ls -la），并简要说明项目结构。";
  return parsed as { workspaceId: string; prompt: string };
}

// ── SSE 解析 ──────────────────────────────────────────────────────────────────

interface SSEEvent {
  eventType: string;
  data: unknown;
}

function parseSSEBuffer(buffer: string): { events: SSEEvent[]; remainder: string } {
  const events: SSEEvent[] = [];
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    if (!part.trim()) continue;
    let eventType = "message";
    let dataLine = "";

    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) eventType = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLine += line.slice(6);
    }

    if (dataLine) {
      try {
        events.push({ eventType, data: JSON.parse(dataLine) });
      } catch {
        events.push({ eventType, data: dataLine });
      }
    }
  }

  return { events, remainder };
}

// ── 格式化输出 ────────────────────────────────────────────────────────────────

const DIVIDER = "─".repeat(72);
const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
} as const;

function colorize(color: keyof typeof COLORS, text: string) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function formatEventData(eventType: string, data: unknown): string {
  if (typeof data === "string") return data;

  const d = data as Record<string, unknown>;

  switch (eventType) {
    case "session_init":
      return `sessionId: ${d.sessionId}\ncwd: ${d.cwd}`;

    case "text_delta":
      return `delta: ${JSON.stringify(d.delta)}`;

    case "thinking_delta":
      return `delta: ${JSON.stringify(d.delta)}`;

    case "thinking_done":
      return `durationSeconds: ${d.durationSeconds}`;

    case "tool_start":
      return [
        `toolName: ${d.toolName}`,
        `toolUseId: ${d.toolUseId}`,
        `input: ${JSON.stringify(d.input, null, 2)}`,
      ].join("\n");

    case "tool_end":
      return [
        `toolName: ${d.toolName ?? "(from tool_start)"}`,
        `toolUseId: ${d.toolUseId}`,
        `isError: ${d.isError}`,
        `durationMs: ${d.durationMs}`,
        `output: ${typeof d.output === "string" ? d.output.slice(0, 500) : JSON.stringify(d.output)}`,
      ].join("\n");

    case "permission_request":
      return [
        `requestId: ${d.requestId}`,
        `toolName: ${d.toolName}`,
        `input: ${JSON.stringify(d.input, null, 2)}`,
        `title: ${d.title}`,
        `description: ${d.description}`,
      ].join("\n");

    case "permission_resolved":
      return `requestId: ${d.requestId}\nbehavior: ${d.behavior}`;

    case "done":
      return [
        `sessionId: ${d.sessionId}`,
        `costUsd: ${d.costUsd}`,
        `durationMs: ${d.durationMs}`,
      ].join("\n");

    case "error":
      return `message: ${d.message}`;

    case "sdk_message":
      // 原始 SDK 消息，简要显示
      return `type: ${(d as { message?: { type?: string } })?.message?.type ?? "unknown"}`;

    default:
      return JSON.stringify(data, null, 2);
  }
}

function printEvent(index: number, eventType: string, data: unknown) {
  const typeColors: Record<string, keyof typeof COLORS> = {
    session_init: "green",
    text_delta: "cyan",
    thinking_delta: "magenta",
    thinking_done: "magenta",
    tool_start: "yellow",
    tool_end: "yellow",
    permission_request: "red",
    permission_resolved: "blue",
    done: "green",
    error: "red",
    sdk_message: "dim",
  };

  const color = typeColors[eventType] ?? "dim";
  const header = `[${String(index).padStart(3, "0")}] ${colorize(color, eventType)}`;

  console.log(header);
  console.log(formatEventData(eventType, data));

  // 对 text_delta 只打印简短摘要，避免刷屏
  if (eventType === "text_delta") {
    const delta = (data as Record<string, unknown>)?.delta;
    if (typeof delta === "string" && delta.length > 100) {
      console.log(colorize("dim", `  (${delta.length} chars)`));
    }
  }

  console.log(DIVIDER);
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  const { workspaceId, prompt } = parseArgs();

  console.log(colorize("bright", "\n🔍 Sandbox 任务测试工具"));
  console.log(DIVIDER);
  console.log(`Workspace ID: ${workspaceId}`);
  console.log(`Prompt: ${prompt}`);
  console.log(DIVIDER);

  // 1. 查找 workspace
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!workspace) {
    console.error(colorize("red", `❌ Workspace ${workspaceId} 不存在`));
    process.exit(1);
  }

  console.log(`\n📋 Workspace: ${workspace.name}`);
  console.log(`   sandboxId: ${workspace.sandboxId ?? "(无)"}`);
  console.log(`   sandboxStatus: ${workspace.sandboxStatus}`);

  // 查找关联的 project
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .limit(1);

  if (!project) {
    console.error(colorize("red", `❌ 该 workspace 下没有关联的项目`));
    process.exit(1);
  }

  console.log(`   Project: ${project.name} (path: ${project.path})`);

  // 2. 获取或创建 Sandbox
  console.log(colorize("bright", "\n🚀 获取 Sandbox 实例..."));
  const startTime = Date.now();

  let sandbox;
  try {
    sandbox = await SandboxManager.getOrCreate(workspaceId);
  } catch (err) {
    console.error(colorize("red", `\n❌ Sandbox 创建失败:`));
    console.error(err);
    process.exit(1);
  }

  console.log(colorize("green", `   ✓ Sandbox 就绪 (${((Date.now() - startTime) / 1000).toFixed(1)}s)`));

  // 3. 确保 server 运行
  console.log(colorize("bright", "\n🌐 确认 Sandbox HTTP Server 运行状态..."));

  let baseUrl: string;
  try {
    ({ baseUrl } = await SandboxManager.ensureServerRunning(workspaceId, sandbox));
  } catch (err) {
    console.error(colorize("red", `\n❌ Sandbox Server 启动失败:`));
    console.error(err);
    process.exit(1);
  }

  console.log(colorize("green", `   ✓ Server 地址: ${baseUrl}`));

  // 4. 先测试 /health
  console.log(colorize("bright", "\n💓 健康检查..."));
  try {
    const healthRes = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    const healthBody = await healthRes.text();
    console.log(`   Status: ${healthRes.status}`);
    console.log(`   Body: ${healthBody}`);

    if (!healthRes.ok) {
      console.error(colorize("red", "   ❌ Server 不健康，终止测试"));
      process.exit(1);
    }
    console.log(colorize("green", "   ✓ Server 健康"));
  } catch (err) {
    console.error(colorize("red", `   ❌ Health check 失败:`));
    console.error(err);
    process.exit(1);
  }

  // 5. 发送 /stream 请求
  const cwd = `/workspace/${project.path}`;
  console.log(colorize("bright", "\n📤 发送任务到 Sandbox Server..."));
  console.log(`   URL: ${baseUrl}/stream`);
  console.log(`   cwd: ${cwd}`);
  console.log(`   prompt: ${prompt}`);
  console.log(DIVIDER);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        cwd,
        permissionMode: "default",
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 分钟超时
    });
  } catch (err) {
    console.error(colorize("red", `\n❌ 请求失败:`));
    console.error(err);
    process.exit(1);
  }

  console.log(`\n响应状态: ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get("content-type")}`);
  console.log(DIVIDER);

  if (!res.ok) {
    const body = await res.text();
    console.error(colorize("red", `❌ Sandbox 返回错误 ${res.status}:`));
    console.error(body);
    process.exit(1);
  }

  // 6. 流式读取并解析 SSE
  const reader = res.body?.getReader();
  if (!reader) {
    console.error(colorize("red", "❌ 响应体为空"));
    process.exit(1);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  let textAccumulator = "";
  const streamStartTime = Date.now();

  console.log(colorize("bright", "\n📡 开始接收 SSE 事件流...\n"));
  console.log(DIVIDER);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, remainder } = parseSSEBuffer(buffer);
      buffer = remainder;

      for (const event of events) {
        eventCount++;
        printEvent(eventCount, event.eventType, event.data);

        // 累积文本输出
        if (event.eventType === "text_delta") {
          const delta = (event.data as Record<string, unknown>)?.delta;
          if (typeof delta === "string") textAccumulator += delta;
        }

        // 遇到错误或完成时打印汇总
        if (event.eventType === "error") {
          console.log(colorize("red", "\n⚠️  Sandbox 返回了错误事件"));
        }

        if (event.eventType === "done") {
          const elapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
          console.log(colorize("green", `\n✅ 任务完成 (${elapsed}s, ${eventCount} events)`));
          if (textAccumulator) {
            console.log(colorize("bright", "\n📝 完整文本输出:"));
            console.log(DIVIDER);
            console.log(textAccumulator);
            console.log(DIVIDER);
          }
        }
      }
    }
  } catch (err) {
    console.error(colorize("red", `\n❌ 流读取中断:`));
    console.error(err);
  }

  // 处理 buffer 中剩余的数据
  if (buffer.trim()) {
    const { events } = parseSSEBuffer(buffer + "\n\n");
    for (const event of events) {
      eventCount++;
      printEvent(eventCount, event.eventType, event.data);
    }
  }

  const totalElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
  console.log(colorize("bright", `\n📊 测试汇总:`));
  console.log(`   总事件数: ${eventCount}`);
  console.log(`   总耗时: ${totalElapsed}s`);
  console.log(`   文本长度: ${textAccumulator.length} chars`);
  console.log(DIVIDER);
}

main().catch((err) => {
  console.error(colorize("red", "\n💥 未捕获异常:"));
  console.error(err);
  process.exit(1);
});
