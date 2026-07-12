import { redirect } from "next/navigation";

interface WorkspaceRootPageProps {
  params: Promise<{ workspace: string }>;
}

export default async function WorkspaceRootPage({ params }: WorkspaceRootPageProps) {
  const { workspace } = await params;
  redirect(`/${workspace}/chat`);
}
