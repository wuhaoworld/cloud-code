/**
 * List or permanently delete E2B sandboxes created by this application.
 *
 * Usage:
 *   npx tsx scripts/cleanup-sandboxes.ts
 *   npx tsx scripts/cleanup-sandboxes.ts --yes
 *   npx tsx scripts/cleanup-sandboxes.ts --yes --workspace-id my-workspace
 */

import "dotenv/config";
import { Sandbox } from "e2b";

function parseArgs(argv: string[]) {
  const args = { yes: false, workspaceId: undefined as string | undefined };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--yes" || argv[index] === "-y") args.yes = true;
    if (argv[index] === "--workspace-id") args.workspaceId = argv[++index];
  }
  return args;
}

async function main() {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY is required");
  const { yes, workspaceId } = parseArgs(process.argv.slice(2));
  const paginator = Sandbox.list({
    apiKey,
    query: workspaceId ? { metadata: { workspaceId } } : undefined,
  });
  const sandboxes = [];
  do {
    sandboxes.push(...await paginator.nextItems());
  } while (paginator.hasNext);

  console.log(`${yes ? "⚠️ 删除" : "ℹ️ Dry-run"}：找到 ${sandboxes.length} 个 E2B sandbox`);
  for (const sandbox of sandboxes) {
    console.log(`  - ${sandbox.sandboxId} (${sandbox.state})`);
    if (yes) await Sandbox.kill(sandbox.sandboxId, { apiKey });
  }
  if (!yes) console.log("这是 dry-run；确认后加 --yes 才会永久删除。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
