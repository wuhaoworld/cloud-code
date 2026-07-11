/**
 * 直接调用 Next.js `/api/chat/stream` 接口的调试脚本（而不是直连 Sandbox Server）。
 *
 * 目的：定位问题究竟出在哪一层——
 *
 *   浏览器
 *     └─> app/api/chat/stream/route.ts   (Next.js API Route)  ← 本脚本测的就是这一层
 *           └─> SandboxManager.getOrCreate / ensureServerRunning
 *                 └─> lib/sandbox-setup.ts  (npm install + 校验 claude 二进制)
 *                       └─> Sandbox 内部 HTTP Server  /stream   ← test-stream-direct.ts 测的是这一层
 *                             └─> claude-agent-sdk 的 query()，真正 spawn claude 二进制
 *
 * 如果 test-stream-direct.ts（直连 sandbox /stream）能正常返回，但网页报错，
 * 说明问题出在 Next.js Route → SandboxManager 这一段——最典型的原因：
 *   1. SandboxManager 缓存了一个"看起来在跑"但其实已经失效/换了一批 node_modules 的沙箱实例
 *      （例如 dev server 热重载后内存态和 DB 记录的 sandboxId 不一致）
 *   2. ensureServerRunning() 触发了一次新的 bootstrap（重新 npm install），
 *      而这次安装装出来的二进制和之前手测的那次不是同一个产物
 *   3. Next.js route 里传的 env / cwd 与直连测试不同，导致 claude 进程启动参数不同
 *
 * 用法：
 *   npx tsx scripts/test-chat-api.ts \
 *     --email you@example.com --password ****** \
 *     --project <projectId> \
 *     [--prompt "Hello"] [--base-url http://localhost:3000] [--session <sessionId>]
 *
 * 说明：
 *   --project 必须是一个 workspaceId 不为空的 project（即走 Sandbox 分支），
 *   可以用下面的 SQL 在本地 DB 里找：
 *     sqlite3 .data/app.db "SELECT p.id, p.name, p.workspace_id, w.sandbox_status \
 *       FROM project p JOIN workspace w ON w.id = p.workspace_id;"
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
  baseUrl: string;
  email?: string;
  password?: string;
  cookie?: string;
  projectId?: string;
  prompt: string;
  sessionId?: string;
  model?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { baseUrl: "http://localhost:3000", prompt: "Hello" };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--base-url" && next) { args.baseUrl   = next.replace(/\/$/, ""); i++; }
    if (flag === "--email"    && next) { args.email     = next; i++; }
    if (flag === "--password" && next) { args.password  = next; i++; }
    if (flag === "--cookie"   && next) { args.cookie    = next; i++; }
    if (flag === "--project"  && next) { args.projectId = next; i++; }
    if (flag === "--prompt"   && next) { args.prompt    = next; i++; }
    if (flag === "--session"  && next) { args.sessionId = next; i++; }
    if (flag === "--model"    && next) { args.model     = next; i++; }
  }

  if (!args.projectId) {
    console.error(col("red", "❌ 必须指定 --project <projectId>"));
    process.exit(1);
  }
  if (!args.cookie && (!args.email || !args.password)) {
    console.error(col("red", "❌ 必须指定 --cookie <session-cookie> 或者 --email + --password 登录"));
    console.error("示例:");
    console.error('  npx tsx scripts/test-chat-api.ts --email you@example.com --password 123456 --project <id>');
    process.exit(1);
  }
  return args;
}

// ── 登录，拿到浏览器同款的 session cookie ────────────────────────────────────

async function signIn(baseUrl: string, email: string, password: string): Promise<string> {
  console.log(col("bold", "\n🔑 POST /api/auth/sign-in/email"));
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    // better-auth 的 CSRF 保护要求 Origin 头存在且命中 trustedOrigins（默认含 BETTER_AUTH_URL）。
    // 脚本是纯 Node fetch，不会像浏览器那样自动带上 Origin，所以要手动补上。
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });

  const body = await res.text();
  console.log(`   ${res.status} ${res.statusText}`);

  if (!res.ok) {
    console.error(col("red", `   ❌ 登录失败: ${body}`));
    process.exit(1);
  }

  // better-auth 通过 Set-Cookie 返回 session token；可能有多个 Set-Cookie 头
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) {
    console.error(col("red", "   ❌ 响应中没有 Set-Cookie，无法提取会话"));
    process.exit(1);
  }

  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  console.log(col("green", `   ✓ 登录成功，拿到 ${setCookies.length} 个 cookie`));
  return cookie;
}

// ── SSE 解析（与 test-stream-direct.ts 一致）────────────────────────────────

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

const TYPE_COLOR: Record<string, Color> = {
  error:               "red",
  done:                "green",
  session_init:        "green",
  permission_request:  "yellow",
  permission_resolved: "blue",
  text_delta:          "cyan",
  thinking_delta:      "magenta",
  tool_start:          "yellow",
  tool_end:            "yellow",
};

let idx = 0;

function printEvent(ev: SSEEvent) {
  idx++;
  const color = TYPE_COLOR[ev.eventType] ?? "dim";
  console.log(`\n[${String(idx).padStart(3, "0")}] ${col(color, ev.eventType)}`);

  if (ev.eventType === "error") {
    console.log(col("red", `  ${ev.rawData}`));
  } else if (ev.eventType === "text_delta" || ev.eventType === "thinking_delta") {
    const d = (ev.parsed as Record<string, unknown>)?.delta;
    console.log(col("dim", `  ${JSON.stringify(d)}`));
  } else {
    const lines = JSON.stringify(ev.parsed, null, 2).split("\n").map(l => "  " + l).join("\n");
    console.log(col("dim", lines));
  }
  console.log(HR);
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log(col("bold", "\n🔍 /api/chat/stream 直连调试工具（走完整 Next.js 链路）"));
  console.log(HR);
  console.log(`  baseUrl   : ${args.baseUrl}`);
  console.log(`  projectId : ${args.projectId}`);
  console.log(`  prompt    : ${args.prompt}`);
  console.log(`  sessionId : ${args.sessionId ?? "(新会话)"}`);
  console.log(HR);

  const cookie = args.cookie ?? await signIn(args.baseUrl, args.email!, args.password!);

  const payload = JSON.stringify({
    projectId: args.projectId,
    prompt: args.prompt,
    sessionId: args.sessionId,
    model: args.model,
    permissionMode: "bypassPermissions",
  });

  console.log(col("bold", `\n📤 POST ${args.baseUrl}/api/chat/stream`));
  console.log(`   ${payload}`);
  console.log(HR);

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${args.baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: payload,
      signal: AbortSignal.timeout(5 * 60 * 1000),
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

  console.log(col("bold", "\n📡 SSE 事件流:"));
  console.log(HR);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let textOut   = "";
  let hasError  = false;
  let errorMsg  = "";

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
        if (ev.eventType === "text_delta") {
          const d = (ev.parsed as Record<string, unknown>)?.delta;
          if (typeof d === "string") textOut += d;
        }
        if (ev.eventType === "error") {
          hasError = true;
          errorMsg = String((ev.parsed as Record<string, unknown>)?.message ?? ev.rawData);
        }
      }
    }
  } catch (err) {
    console.error(col("red", `\n❌ 流读取中断: ${err}`));
    hasError = true;
  }

  if (remainder.trim()) {
    for (const ev of parseSSE(remainder + "\n\n")) printEvent(ev);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(col("bold", "\n📊 汇总"));
  console.log(HR);
  console.log(`  总事件数 : ${idx}`);
  console.log(`  耗时     : ${elapsed}s`);
  console.log(`  状态     : ${hasError ? col("red", "有错误") : col("green", "正常")}`);
  if (hasError) console.log(`  错误信息 : ${col("red", errorMsg)}`);
  if (textOut) {
    console.log(col("bold", "\n📝 AI 文本输出:"));
    console.log(HR);
    console.log(textOut);
  }
  console.log(HR);

  if (hasError && errorMsg.includes("Sandbox failed to start")) {
    console.log(col("yellow",
      "\n💡 提示: 这说明请求根本没走到 sandboxStreamProxy —— " +
      "SandboxManager.getOrCreate() 之后 getRunningInstance() 返回了 null。\n" +
      "   检查 SandboxManager.getOrCreate() 是否抛出异常被吞掉，或者 onCreate/onResume 里 bootstrap 失败。"
    ));
  }
}

main().catch(err => {
  console.error(col("red", "\n💥 未捕获异常:"));
  console.error(err);
  process.exit(1);
});
