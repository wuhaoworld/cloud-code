import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AppSidebar } from "@/components/sidebar/sidebar";
import { WorkspaceSync } from "./workspace-sync";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const { workspace } = await params;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Client component to sync the current workspace ID in Zustand store */}
      <WorkspaceSync workspaceId={workspace} />

      {/* 左侧侧边栏 */}
      <div className="w-76 shrink-0 flex flex-col h-full">
        <AppSidebar />
      </div>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
