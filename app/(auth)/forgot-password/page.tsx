"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Mail } from "lucide-react";

import { requestPasswordReset } from "@/lib/auth-client";
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

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSent, setIsSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!email) {
            toast.error("请输入邮箱地址");
            return;
        }

        setIsLoading(true);
        try {
            const { error } = await requestPasswordReset({
                email,
                redirectTo: `${window.location.origin}/reset-password`,
            });

            if (error) {
                toast.error(error.message ?? "发送失败，请稍后重试");
                return;
            }

            setIsSent(true);
            toast.success("重置链接已发送！请查收邮件");
        } catch {
            toast.error("发送时发生错误，请稍后重试");
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
                            <Mail className="size-6 text-primary-foreground" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-semibold">
                        {isSent ? "邮件已发送" : "找回密码"}
                    </CardTitle>
                    <CardDescription className="text-sm mt-1">
                        {isSent
                            ? `我们已将重置链接发送至 ${email}，请查收邮件并点击链接。`
                            : "输入您的注册邮箱，我们将发送重置链接"}
                    </CardDescription>
                </CardHeader>

                <CardContent className="pt-4">
                    {isSent ? (
                        <div className="flex flex-col gap-4">
                            <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground text-center">
                                <p>如果该邮箱已注册，您将在几分钟内收到重置邮件。</p>
                                <p className="mt-1">请同时检查垃圾邮件文件夹。</p>
                            </div>
                            <Button
                                id="forgot-password-resend"
                                variant="outline"
                                className="w-full"
                                onClick={() => {
                                    setIsSent(false);
                                    setEmail("");
                                }}
                            >
                                重新发送
                            </Button>
                        </div>
                    ) : (
                        <form
                            id="forgot-password-form"
                            onSubmit={handleSubmit}
                            className="flex flex-col gap-4"
                        >
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="forgot-password-email">邮箱</Label>
                                <Input
                                    id="forgot-password-email"
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

                            <Button
                                id="forgot-password-submit"
                                type="submit"
                                className="w-full mt-1"
                                size="lg"
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="size-4 animate-spin" />
                                        发送中…
                                    </>
                                ) : (
                                    "发送重置链接"
                                )}
                            </Button>
                        </form>
                    )}
                </CardContent>

                <CardFooter className="justify-center pt-0">
                    <Link
                        href="/sign-in"
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ArrowLeft className="size-3.5" />
                        返回登录
                    </Link>
                </CardFooter>
            </Card>
        </div>
    );
}
