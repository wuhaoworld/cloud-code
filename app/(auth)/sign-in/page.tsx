"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";

import { signIn } from "@/lib/auth-client";
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

export default function SignInPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!email || !password) {
            toast.error("请填写邮箱和密码");
            return;
        }

        setIsLoading(true);
        try {
            const { data, error } = await signIn.email({
                email,
                password,
                callbackURL: `${window.location.origin}/`,
            });

            if (error) {
                toast.error(error.message ?? "登录失败，请检查邮箱和密码");
                return;
            }

            if (data) {
                toast.success("登录成功！");
                router.push("/");
                router.refresh();
            }
        } catch {
            toast.error("登录时发生错误，请稍后重试");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader className="text-center pb-2">
                    <div className="flex justify-center mb-4">
                        <div className="size-12 rounded-2xl bg-primary flex items-center justify-center shadow-md">
                            <LogIn className="size-6 text-primary-foreground" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-semibold">欢迎回来</CardTitle>
                    <CardDescription className="text-sm mt-1">
                        输入您的邮箱和密码登录账号
                    </CardDescription>
                </CardHeader>

                <CardContent className="pt-4">
                    <form id="sign-in-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="sign-in-email">邮箱</Label>
                            <Input
                                id="sign-in-email"
                                type="email"
                                placeholder="you@example.com"
                                autoComplete="email"
                                autoFocus
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={isLoading}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="sign-in-password">密码</Label>
                                <Link
                                    href="/forgot-password"
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    忘记密码？
                                </Link>
                            </div>
                            <div className="relative">
                                <Input
                                    id="sign-in-password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="请输入密码"
                                    autoComplete="current-password"
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
                                    {showPassword ? (
                                        <EyeOff className="size-4" />
                                    ) : (
                                        <Eye className="size-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        <Button
                            id="sign-in-submit"
                            type="submit"
                            className="w-full mt-1"
                            size="lg"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="size-4 animate-spin" />
                                    登录中…
                                </>
                            ) : (
                                "登录"
                            )}
                        </Button>
                    </form>
                </CardContent>

                <CardFooter className="justify-center pt-0">
                    <p className="text-sm text-muted-foreground">
                        还没有账号？{" "}
                        <Link
                            href="/sign-up"
                            className="font-medium text-foreground hover:underline underline-offset-4 transition-colors"
                        >
                            立即注册
                        </Link>
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
}
