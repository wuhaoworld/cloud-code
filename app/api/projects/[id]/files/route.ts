import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

// GET /api/projects/[id]/files?q=<filter>
// 返回项目目录下的文件列表（最多 200 条），用于 chat-input @ 触发的文件面板
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const q = req.nextUrl.searchParams.get('q')?.toLowerCase() ?? '';

  // 验证项目归属
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const rootPath = project.path;

  // 递归读取文件（忽略隐藏文件和常见忽略目录）
  const IGNORE_DIRS = new Set([
    'node_modules', '.git', '.next', 'dist', 'out', 'build', '.cache',
    '.turbo', '.pnpm', 'coverage', '__pycache__', '.venv', 'venv',
  ]);

  const results: string[] = [];

  function walk(dir: string, rel: string, depth: number) {
    if (depth > 6 || results.length >= 200) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        results.push(`${relPath}/`);
        walk(path.join(dir, entry.name), relPath, depth + 1);
      } else {
        results.push(relPath);
      }
      if (results.length >= 200) break;
    }
  }

  try {
    walk(rootPath, '', 0);
  } catch {
    return NextResponse.json({ files: [] });
  }

  const filtered = q
    ? results.filter((f) => f.toLowerCase().includes(q)).slice(0, 20)
    : results.slice(0, 20);

  return NextResponse.json({ files: filtered });
}
