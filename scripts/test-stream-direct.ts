/**
 * 直接测试 Sandbox 内部 /stream 接口的调试脚本。
 *
 * 不依赖数据库或 SandboxManager，直接发 POST 请求到已知的 Sandbox Server URL，
 * 把所有原始 SSE 事件完整打印出来，方便定位 claude binary 启动失败的根本原因。
 *
 * 用法 1: 指定 sandbox server URL（最常用）
 *   npx tsx scripts/test-stream-direct.ts --url https://<sandbox-domain>
 *
 * 用法 2: 通过 workspaceId 自动查询 sandbox URL（需要 .env 和 DB）
 *   npx tsx scripts/test-stream-direct.ts --workspace <workspaceId>
 *
 * 选项:
 *   --prompt "xxx"   发送的提示词（默认: "Hello"）
 *   --cwd   "/path"  工作目录（默认: "/tmp"）
 */

import "dotenv/config";

// ── 颜色辅助 ──────────────────────────────────────────────────────────────────

const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  blue:    "\x1b[34m",
} as const;

type Color = keyof typeof C;
const col = (color: Color, text: string) => `${C[color]}${text}${C.reset}`;
const HR = "─".repeat(72);

// ── 参数解析 ──────────────────────────────────────────────────────────────────

interface Args {
  serverUrl?: string;
  workspaceId?: string;
  prompt: string;
  cwd: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { prompt: "Hello", cwd: "/tmp" };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--url"       && next) { args.serverUrl   = next.replace(/\/$/, ""); i++; }
    if (flag === "--workspace" && next) { args.workspaceId = next; i++; }
    if (flag === "--prompt"    && next) { args.prompt      = next; i++; }
    if (flag === "--cwd"       && next) { args.cwd         = next; i++; }
  }

  if (!args.serverUrl && !args.workspaceId) {
    console.error(col("red", "❌ 必须指定 --url <sandbox-base-url> 或 --workspace <workspaceId>"));
    console.error("示例:");
    console.error("  npx tsx scripts/test-stream-direct.ts --url https://xxx.vercel.app");
    console.error("  npx tsx scripts/test-stream-direct.ts --workspace abc123");
    process.exit(1);
  }
  return args;
}

// ── 通过 workspaceId 从 DB 查 sandbox URL ────────────────────────────────────

async function resolveServerUrl(workspaceId: string): Promise<string> {
  const { db }        = await import("../db");
  const { workspaces }= await import("../db/schema");
  const { eq }        = await import("drizzle-orm");

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) { console.error(col("red", `❌ Workspace ${workspaceId} 不存在`)); process.exit(1); }
  if (!ws.sandboxId) { console.error(col("red", `❌ Workspace ${workspaceId} 没有关联 sandboxId`)); process.exit(1); }

  console.log(`📋 Workspace: ${ws.name}  sandboxId: ${ws.sandboxId}  status: ${ws.sandboxStatus}`);

  // Attempt to resolve sandbox public domain via @vercel/sandbox
  try {
    const { Sandbox } = await import("@vercel/sandbox");
    const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
    const creds = VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID
      ? { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID }
      : {};
    const sandbox = await (Sandbox as any).get({ name: ws.sandboxId, ...creds });
    const baseUrl: string = sandbox.domain(3001);
    console.log(col("green", `   ✓ Sandbox base URL: ${baseUrl}`));
    return baseUrl;
  } catch (err) {
    console.error(col("red", `❌ 连接 Sandbox 失败: ${err}`));
    process.exit(1);
  }
}

// ── SSE 解析 ──────────────────────────────────────────────────────────────────

interface SSEEvent { eventType: string; rawData: string; parsed: unknown; }

function* parseSSE(raw: string): Generator<SSEEvent> {
  const blocks = raw.split("\n\n");
  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventType = "message";
    let dataLine  = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: "))     eventType = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLine += line.slice(6);
    }
    if (!dataLine) continue;
    let parsed: unknown = dataLine;
    try { parsed = JSON.parse(dataLine); } catch { /* keep raw string */ }
    yield { eventType, rawData: dataLine, parsed };
  }
}

// ── 事件打印 ──────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, Color> = {
  sdk_message:         "dim",
  error:               "red",
  done:                "green",
  permission_request:  "yellow",
  permission_resolved: "blue",
};

let idx = 0;

function printEvent(ev: SSEEvent) {
  idx++;
  const color = TYPE_COLOR[ev.eventType] ?? "cyan";
  console.log(`\n[${String(idx).padStart(3, "0")}] ${col(color, ev.eventType)}`);

  if (ev.eventType === "sdk_message" && typeof ev.parsed === "object" && ev.parsed !== null) {
    const msg = (ev.parsed as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (msg) {
      // Print the inner message type prominently
      console.log(`  ${col("bold", "type:")} ${msg.type}`);
      // Print every other field so we see the full error payload
      for (const [k, v] of Object.entries(msg)) {
        if (k === "type") continue;
        const str =
          typeof v === "string"
            ? v.length > 800 ? v.slice(0, 800) + col("dim", `… (+${v.length - 800} chars)`) : v
            : JSON.stringify(v, null, 2);
        console.log(`  ${col("bold", k + ":")} ${str}`);
      }
    } else {
      console.log(col("dim", `  ${ev.rawData.slice(0, 400)}`));
    }
  } else if (ev.eventType === "error") {
    // Full error — the most useful thing for debugging
    console.log(col("red", `  ${ev.rawData}`));
  } else {
    const lines = JSON.stringify(ev.parsed, null, 2).split("\n").map(l => "  " + l).join("\n");
    console.log(col("dim", lines));
  }

  console.log(HR);
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log(col("bold", "\n🔍 Sandbox /stream 直连调试工具"));
  console.log(HR);
  console.log(`  prompt : ${args.prompt}`);
  console.log(`  cwd    : ${args.cwd}`);
  console.log(HR);

  const baseUrl = args.serverUrl ?? await resolveServerUrl(args.workspaceId!);

  // ── 健康检查 ────────────────────────────────────────────────────────────────
  console.log(col("bold", "\n💓 GET /health"));
  try {
    const r    = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    const body = await r.text();
    console.log(`   ${r.status}  ${body}`);
    if (!r.ok) { console.error(col("red", "   ❌ 不健康")); process.exit(1); }
    console.log(col("green", "   ✓ OK"));
  } catch (err) {
    console.error(col("red", `   ❌ ${err}`));
    process.exit(1);
  }

  // ── POST /stream ────────────────────────────────────────────────────────────
  const payload = JSON.stringify({ prompt: args.prompt, cwd: args.cwd, permissionMode: "bypassPermissions" });
  console.log(col("bold", `\n📤 POST ${baseUrl}/stream`));
  console.log(`   ${payload}`);
  console.log(HR);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(3 * 60 * 1000),
    });
  } catch (err) {
    console.error(col("red", `\n❌ 请求失败: ${err}`));
    process.exit(1);
  }

  console.log(`\nHTTP ${res.status} ${res.statusText}`);
  console.log(`Content-Type: ${res.headers.get("content-type")}`);

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "(无法读取响应体)");
    console.error(col("red", `\n❌ ${txt}`));
    process.exit(1);
  }

  // ── 流式读取 SSE ────────────────────────────────────────────────────────────
  console.log(col("bold", "\n📡 SSE 事件流:"));
  console.log(HR);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  const t0      = Date.now();
  let textOut   = "";
  let hasError  = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const raw     = remainder + decoder.decode(value, { stream: true });
      const lastSep = raw.lastIndexOf("\n\n");
      if (lastSep === -1) { remainder = raw; continue; }
      remainder     = raw.slice(lastSep + 2);

      for (const ev of parseSSE(raw.slice(0, lastSep + 2))) {
        printEvent(ev);
        if (ev.eventType === "sdk_message") {
          const msg = (ev.parsed as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
          if (msg?.type === "assistant" && Array.isArray(msg.content)) {
            for (const blk of msg.content as Record<string, unknown>[]) {
              if (blk.type === "text") textOut += (blk.text as string) ?? "";
            }
          }
        }
        if (ev.eventType === "error") hasError = true;
      }
    }
  } catch (err) {
    console.error(col("red", `\n❌ 流读取中断: ${err}`));
    hasError = true;
  }

  if (remainder.trim()) {
    for (const ev of parseSSE(remainder + "\n\n")) printEvent(ev);
  }

  // ── 汇总 ───────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(col("bold", "\n📊 汇总"));
  console.log(HR);
  console.log(`  总事件数 : ${idx}`);
  console.log(`  耗时     : ${elapsed}s`);
  console.log(`  状态     : ${hasError ? col("red", "有错误") : col("green", "正常")}`);

  if (textOut) {
    console.log(col("bold", "\n📝 AI 文本输出:"));
    console.log(HR);
    console.log(textOut);
  }
  console.log(HR);
}

main().catch(err => {
  console.error(col("red", "\n💥 未捕获异常:"));
  console.error(err);
  process.exit(1);
});
