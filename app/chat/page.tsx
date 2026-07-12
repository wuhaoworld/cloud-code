import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";
import { OnboardingClient } from "./onboarding";

export default async function ChatPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  // 查询用户的第一个 workspace（按创建时间排序）
  const userWorkspaces = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, session.user.id))
    .orderBy(workspaces.createdAt)
    .limit(1);

  if (userWorkspaces.length > 0) {
    redirect(`/${userWorkspaces[0].id}/chat`);
  }

  // 无 workspace，渲染 onboarding 表单
  return <OnboardingClient />;
}
