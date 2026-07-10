/**
 * 清理线上所有 Vercel Sandbox 和 Snapshot。
 *
 * ⚠️ 危险操作：默认以 dry-run 模式运行，仅打印将要删除的资源，不会真正删除。
 * 加上 --yes 参数才会真正执行删除。
 *
 * 用法：
 *   npx tsx scripts/cleanup-sandboxes.ts                    # dry-run，仅列出
 *   npx tsx scripts/cleanup-sandboxes.ts --yes               # 真正删除所有 sandbox + snapshot
 *   npx tsx scripts/cleanup-sandboxes.ts --yes --name-prefix ci-   # 只删除匹配前缀的 sandbox（及其快照）
 *
 * 环境变量（.env 中已配置）：
 *   VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID
 */

import "dotenv/config";
import { Sandbox, Snapshot } from "@vercel/sandbox";

function getCredentials() {
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  if (!VERCEL_TOKEN || !VERCEL_TEAM_ID || !VERCEL_PROJECT_ID) {
    throw new Error(
      "缺少 VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID 环境变量"
    );
  }
  return {
    token: VERCEL_TOKEN,
    teamId: VERCEL_TEAM_ID,
    projectId: VERCEL_PROJECT_ID,
  };
}

function parseArgs(argv: string[]) {
  const args = { yes: false, namePrefix: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "-y") {
      args.yes = true;
    } else if (arg === "--name-prefix") {
      args.namePrefix = argv[++i];
    }
  }
  return args;
}

async function main() {
  const { yes, namePrefix } = parseArgs(process.argv.slice(2));
  const credentials = getCredentials();

  console.log(
    yes
      ? "⚠️  真实删除模式：将会永久删除所有匹配的 Sandbox 及其 Snapshot！"
      : "ℹ️  Dry-run 模式：仅列出将被删除的资源，不会真正删除（加 --yes 才会真正删除）"
  );
  if (namePrefix) console.log(`过滤条件：name-prefix = "${namePrefix}"`);
  console.log("");

  // 1. 列出所有 Sandbox（可选按名称前缀过滤）
  const sandboxNames: string[] = [];
  const sandboxList = await Sandbox.list({ ...credentials, namePrefix });
  for await (const sandbox of sandboxList) {
    sandboxNames.push(sandbox.name);
  }

  console.log(`发现 ${sandboxNames.length} 个 Sandbox：`);
  sandboxNames.forEach((name) => console.log(`  - ${name}`));
  console.log("");

  // 2. 删除每个 Sandbox 自身的 Snapshot，再删除 Sandbox 本身
  let deletedSandboxCount = 0;
  let deletedSnapshotCount = 0;

  for (const name of sandboxNames) {
    try {
      const sandbox = await Sandbox.get({ name, resume: false, ...credentials });

      const snapshotIds: string[] = [];
      const snapshots = await sandbox.listSnapshots();
      for await (const snapshot of snapshots) {
        snapshotIds.push(snapshot.id);
      }
      if (snapshotIds.length > 0) {
        console.log(`  Sandbox "${name}" 关联 ${snapshotIds.length} 个 snapshot`);
      }

      if (yes) {
        for (const snapshotId of snapshotIds) {
          try {
            const snapshot = await Snapshot.get({ snapshotId, ...credentials });
            await snapshot.delete();
            deletedSnapshotCount++;
            console.log(`    ✅ 已删除 snapshot: ${snapshotId}`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`    ❌ 删除 snapshot 失败: ${snapshotId} — ${message}`);
          }
        }

        await sandbox.delete();
        deletedSandboxCount++;
        console.log(`  ✅ 已删除 sandbox: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ 处理 sandbox 失败: ${name} — ${message}`);
    }
  }

  // 3. 兜底清理：项目中可能残留的孤儿 snapshot（不属于任何现存 sandbox，
  //    仅在未按 name-prefix 过滤的全量清理场景下执行）
  if (!namePrefix) {
    const orphanSnapshotIds: string[] = [];
    const allSnapshots = await Snapshot.list({ ...credentials });
    for await (const snapshot of allSnapshots) {
      orphanSnapshotIds.push(snapshot.id);
    }

    if (orphanSnapshotIds.length > 0) {
      console.log("");
      console.log(`发现 ${orphanSnapshotIds.length} 个残留 Snapshot（项目级）：`);
      orphanSnapshotIds.forEach((id) => console.log(`  - ${id}`));

      if (yes) {
        for (const snapshotId of orphanSnapshotIds) {
          try {
            const snapshot = await Snapshot.get({ snapshotId, ...credentials });
            await snapshot.delete();
            deletedSnapshotCount++;
            console.log(`  ✅ 已删除残留 snapshot: ${snapshotId}`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`  ❌ 删除残留 snapshot 失败: ${snapshotId} — ${message}`);
          }
        }
      }
    }
  }

  console.log("");
  if (!yes) {
    console.log(
      "这是 dry-run，未执行任何删除。确认无误后加 --yes 参数重新运行以真正删除。"
    );
  } else {
    console.log(
      `清理完成：删除了 ${deletedSandboxCount} 个 sandbox，${deletedSnapshotCount} 个 snapshot。`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
