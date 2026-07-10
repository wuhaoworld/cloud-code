/**
 * 测试脚本：在 Sandbox 中执行 claude --version，验证 CLI 是否可用。
 *
 * 用法:
 *   npx tsx scripts/test-sandbox-claude-version.ts --workspace <workspaceId>
 *
 * 示例:
 *   npx tsx scripts/test-sandbox-claude-version.ts --workspace 76cf180b-3d71-4a52-b866-d84db1652a97
 */

import "dotenv/config";
import { db } from "../db";
import { workspaces } from "../db/schema";
import { eq } from "drizzle-orm";
import { SandboxManager } from "../lib/sandbox-manager";

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
} as const;

function c(color: keyof typeof COLORS, text: string) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

async function main() {
  const workspaceId = process.argv.find((_, i, a) => a[i - 1] === "--workspace");
  if (!workspaceId) {
    console.error("用法: npx tsx scripts/test-sandbox-claude-version.ts --workspace <workspaceId>");
    process.exit(1);
  }

  console.log(c("bright", "\n🔍 Sandbox Claude 版本检测"));
  console.log("─".repeat(50));
  console.log(`Workspace: ${workspaceId}`);

  // 1. 查找 workspace
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!workspace) {
    console.error(c("red", `❌ Workspace ${workspaceId} 不存在`));
    process.exit(1);
  }

  console.log(`名称: ${workspace.name}`);
  console.log(`状态: ${workspace.sandboxStatus}`);
  console.log("─".repeat(50));

  // 2. 获取 Sandbox 实例
  console.log(c("bright", "\n🚀 获取 Sandbox 实例..."));
  const t0 = Date.now();

  let sandbox;
  try {
    sandbox = await SandboxManager.getOrCreate(workspaceId);
  } catch (err) {
    console.error(c("red", `\n❌ Sandbox 获取失败:`));
    console.error(err);
    process.exit(1);
  }

  console.log(c("green", `   ✓ 就绪 (${((Date.now() - t0) / 1000).toFixed(1)}s)`));

  // 3. 执行 claude --version
  console.log(c("bright", "\n📦 执行 claude --version...\n"));

  const result = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `bin=$(which claude 2>/dev/null); ` +
        `echo "which claude: ${"$"}{bin:-NOT FOUND}"; ` +
        `echo "PATH: $PATH"; ` +
        `echo "---"; ` +
        `if [ -n "$bin" ]; then "$bin" --version 2>&1; ` +
        `else echo "claude binary not found in PATH"; exit 1; fi`,
    ],
  });

  const stdout = await result.stdout();
  const stderr = await result.stderr();

  console.log("stdout:");
  console.log(stdout || c("dim", "(空)"));

  if (stderr) {
    console.log(c("yellow", "\nstderr:"));
    console.log(stderr);
  }

  console.log("─".repeat(50));
  console.log(`exitCode: ${result.exitCode}`);

  if (result.exitCode === 0) {
    console.log(c("green", "\n✅ claude CLI 可用"));
  } else {
    console.log(c("red", "\n❌ claude CLI 不可用或执行失败"));
    console.log(c("dim", "可能原因: 未安装、权限不足、二进制损坏"));
  }
}

main().catch((err) => {
  console.error(c("red", "\n💥 未捕获异常:"));
  console.error(err);
  process.exit(1);
});
