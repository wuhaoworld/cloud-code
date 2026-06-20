import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface SkillGroup {
  label: string;
  skills: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
}

// GET /api/projects/[id]/skills
// 读取项目 .agents/skills/ 目录，返回已安装的 skill 列表
// 与 cowork 的 window.electron.listSkills() 等效
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const groups: SkillGroup[] = [];
  const skillsDir = path.join(project.path, '.agents', 'skills');

  if (!fs.existsSync(skillsDir)) {
    return NextResponse.json({ groups });
  }

  try {
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    const skills = [];
    for (const skillName of skillDirs) {
      const skillMdPath = path.join(skillsDir, skillName, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const raw = fs.readFileSync(skillMdPath, 'utf-8');
        const { data } = matter(raw);
        skills.push({
          id: skillName,
          name: (data.name as string) || skillName,
          description: (data.description as string) || null,
        });
      } catch {
        skills.push({ id: skillName, name: skillName, description: null });
      }
    }

    if (skills.length > 0) {
      groups.push({ label: '项目技能', skills });
    }
  } catch {
    // 读取失败时返回空列表
  }

  return NextResponse.json({ groups });
}
