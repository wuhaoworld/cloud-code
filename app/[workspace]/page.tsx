"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";

interface WorkspaceRootPageProps {
  params: Promise<{ workspace: string }>;
}

export default function WorkspaceRootPage({ params }: WorkspaceRootPageProps) {
  const { workspace } = use(params);
  const router = useRouter();

  useEffect(() => {
    if (workspace) {
      router.replace(`/${workspace}/chat`);
    }
  }, [workspace, router]);

  return null;
}
