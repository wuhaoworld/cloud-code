"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react";

import { signUp } from "@/lib/auth-client";
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

export default function SignUpPage() {
    const router = useRouter();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [confirmPasswordBlurred, setConfirmPasswordBlurred] = useState(false);
    const [passwordBlurred, setPasswordBlurred] = useState(false);
    const [emailBlurred, setEmailBlurred] = useState(false);

    const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!name.trim()) {
            toast.error("请输入您的姓名");
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
            const { data, error } = await signUp.email({
                name: name.trim(),
                email,
                password,
                callbackURL: `${window.location.origin}/`,
            });

            if (error) {
                toast.error(error.message ?? "注册失败，请稍后重试");
                return;
            }

            if (data) {
                toast.success("注册成功！欢迎加入！");
                router.push("/");
                router.refresh();
            }
        } catch {
            toast.error("注册时发生错误，请稍后重试");
        } finally {
            setIsLoading(false);
        }
    };


    return (
        <div className="flex items-center justify-center">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader className="text-center pt-2 pb-2">
                    <CardTitle className="text-2xl font-semibold">创建账号</CardTitle>
                    <CardDescription className="text-sm mt-1">
                        填写以下信息开始使用
                    </CardDescription>
                </CardHeader>

                <CardContent className="pt-4">
                    <form id="sign-up-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="sign-up-name">姓名</Label>
                            <Input
                                id="sign-up-name"
                                type="text"
                                placeholder="您的姓名"
                                autoComplete="name"
                                autoFocus
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                disabled={isLoading}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="sign-up-email">邮箱</Label>
                            <Input
                                id="sign-up-email"
                                type="email"
                                placeholder="you@example.com"
                                autoComplete="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onBlur={() => setEmailBlurred(true)}
                                disabled={isLoading}
                                required
                                aria-invalid={
                                    emailBlurred && email.length > 0 && !isValidEmail(email)
                                        ? "true"
                                        : undefined
                                }
                            />
                            {emailBlurred && email.length > 0 && !isValidEmail(email) && (
                                <p className="text-xs text-destructive">请输入有效的邮箱地址</p>
                            )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="sign-up-password">密码</Label>
                            <div className="relative">
                                <Input
                                    id="sign-up-password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="至少 8 位"
                                    autoComplete="new-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onBlur={() => setPasswordBlurred(true)}
                                    disabled={isLoading}
                                    required
                                    className="pr-10"
                                    aria-invalid={
                                        passwordBlurred && password.length > 0 && password.length < 8
                                            ? "true"
                                            : undefined
                                    }
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
                            {passwordBlurred && password.length > 0 && password.length < 8 && (
                                <p className="text-xs text-destructive">密码长度至少需要 8 位</p>
                            )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="sign-up-confirm-password">确认密码</Label>
                            <div className="relative">
                                <Input
                                    id="sign-up-confirm-password"
                                    type={showConfirmPassword ? "text" : "password"}
                                    placeholder="再次输入密码"
                                    autoComplete="new-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    onBlur={() => setConfirmPasswordBlurred(true)}
                                    disabled={isLoading}
                                    required
                                    className="pr-10"
                                    aria-invalid={
                                        confirmPasswordBlurred && confirmPassword.length > 0 && password !== confirmPassword
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
                            {confirmPasswordBlurred && confirmPassword.length > 0 && password !== confirmPassword && (
                                <p className="text-xs text-destructive">两次密码不一致</p>
                            )}
                        </div>

                        <Button
                            id="sign-up-submit"
                            type="submit"
                            className="w-full mt-1"
                            size="lg"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="size-4 animate-spin" />
                                    注册中…
                                </>
                            ) : (
                                "创建账号"
                            )}
                        </Button>
                    </form>
                </CardContent>

                <CardFooter className="justify-center pt-0">
                    <p className="text-sm text-muted-foreground">
                        已有账号？{" "}
                        <Link
                            href="/sign-in"
                            className="font-medium text-foreground hover:underline underline-offset-4 transition-colors"
                        >
                            立即登录
                        </Link>
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
}
