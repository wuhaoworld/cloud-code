"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";

export default function SignOutButton() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);

    const handleSignOut = async () => {
        setIsLoading(true);
        try {
            await signOut({
                fetchOptions: {
                    onSuccess: () => {
                        toast.success("已成功退出登录");
                        router.push("/sign-in");
                        router.refresh();
                    },
                    onError: () => {
                        toast.error("退出失败，请重试");
                    },
                },
            });
        } catch {
            toast.error("退出时发生错误");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Button
            id="sign-out-btn"
            variant="outline"
            className="w-full"
            onClick={handleSignOut}
            disabled={isLoading}
        >
            {isLoading ? (
                <>
                    <Loader2 className="size-4 animate-spin" />
                    退出中…
                </>
            ) : (
                <>
                    <LogOut className="size-4" />
                    退出登录
                </>
            )}
        </Button>
    );
}
