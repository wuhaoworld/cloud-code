"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, KeyRound } from "lucide-react";

import { resetPassword } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ResetPasswordForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get("token");

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!token) {
            toast.error("重置链接无效或已过期，请重新申请");
            return;
        }
        if (password.length < 8) {
            toast.error("密码长度至少需要 8 位");
            return;
        }
        if (password !== confirmPassword) {
            toast.error("两次输入的密码不一致");
            return;
        }

        setIsLoading(true);
        try {
            const { error } = await resetPassword({
                newPassword: password,
                token,
            });

            if (error) {
                toast.error(error.message ?? "重置失败，链接可能已过期");
                return;
            }

            toast.success("密码重置成功！请使用新密码登录");
            router.push("/sign-in");
        } catch {
            toast.error("重置时发生错误，请稍后重试");
        } finally {
            setIsLoading(false);
        }
    };

    if (!token) {
        return (
            <div className="flex items-center justify-center">
                <Card className="w-full max-w-md shadow-lg">
                    <CardHeader className="text-center">
                        <CardTitle className="text-2xl font-semibold">链接无效</CardTitle>
                        <CardDescription className="mt-1">
                            重置链接无效或已过期，请重新申请密码重置。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                        <Button id="reset-password-go-forgot" asChild size="lg">
                            <Link href="/forgot-password">重新申请</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader className="text-center pb-2">
                    <div className="flex justify-center mb-4">
                        <div className="size-12 rounded-2xl bg-primary flex items-center justify-center shadow-md">
                            <KeyRound className="size-6 text-primary-foreground" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-semibold">设置新密码</CardTitle>
                    <CardDescription className="text-sm mt-1">
                        请输入并确认您的新密码
                    </CardDescription>
                </CardHeader>

                <CardContent className="pt-4">
                    <form
                        id="reset-password-form"
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-4"
                    >
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="reset-password-new">新密码</Label>
                            <div className="relative">
                                <Input
                                    id="reset-password-new"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="至少 8 位"
                                    autoComplete="new-password"
                                    autoFocus
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={isLoading}
                                    required
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                                >
                                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="reset-password-confirm">确认新密码</Label>
                            <div className="relative">
                                <Input
                                    id="reset-password-confirm"
                                    type={showConfirmPassword ? "text" : "password"}
                                    placeholder="再次输入新密码"
                                    autoComplete="new-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    disabled={isLoading}
                                    required
                                    className="pr-10"
                                    aria-invalid={
                                        confirmPassword.length > 0 && password !== confirmPassword
                                            ? "true"
                                            : undefined
                                    }
                                />
                                <button
                                    type="button"
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    tabIndex={-1}
                                    aria-label={showConfirmPassword ? "隐藏密码" : "显示密码"}
                                >
                                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                </button>
                            </div>
                            {confirmPassword.length > 0 && password !== confirmPassword && (
                                <p className="text-xs text-destructive">两次密码不一致</p>
                            )}
                        </div>

                        <Button
                            id="reset-password-submit"
                            type="submit"
                            className="w-full mt-1"
                            size="lg"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="size-4 animate-spin" />
                                    重置中…
                                </>
                            ) : (
                                "确认重置密码"
                            )}
                        </Button>
                    </form>
                </CardContent>

                <CardFooter className="justify-center pt-0">
                    <Link
                        href="/sign-in"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        返回登录
                    </Link>
                </CardFooter>
            </Card>
        </div>
    );
}

function ResetPasswordSkeleton() {
    return (
        <div className="flex items-center justify-center">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader className="text-center pb-2">
                    <div className="flex justify-center mb-4">
                        <Skeleton className="size-12 rounded-2xl" />
                    </div>
                    <Skeleton className="h-7 w-32 mx-auto" />
                    <Skeleton className="h-4 w-48 mx-auto mt-1" />
                </CardHeader>
                <CardContent className="pt-4 flex flex-col gap-4">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-10 w-full mt-1" />
                </CardContent>
            </Card>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<ResetPasswordSkeleton />}>
            <ResetPasswordForm />
        </Suspense>
    );
}
