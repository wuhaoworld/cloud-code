import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, User, Sparkles } from "lucide-react";
import SignOutButton from "@/components/sign-out-button";

export default async function Home() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    return (
        <div className="flex flex-col flex-1 items-center justify-center min-h-screen bg-background relative overflow-hidden">
            {/* 背景装饰 */}
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
            </div>

            <main className="relative z-10 flex flex-col items-center gap-8 px-4 text-center max-w-lg w-full">
                {/* Logo / Icon */}
                <div className="flex flex-col items-center gap-3">
                    <div className="size-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
                        <Sparkles className="size-8 text-primary-foreground" />
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight">Cloud Claude</h1>
                </div>

                {session?.user ? (
                    /* 已登录状态 */
                    <Card className="w-full shadow-lg">
                        <CardHeader className="pb-3">
                            <div className="flex items-center gap-3">
                                <Avatar className="size-10">
                                    <AvatarFallback className="bg-primary text-primary-foreground font-medium">
                                        {session.user.name
                                            ? session.user.name.slice(0, 2).toUpperCase()
                                            : session.user.email.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="text-left">
                                    <CardTitle className="text-base">{session.user.name || "用户"}</CardTitle>
                                    <CardDescription className="text-xs">{session.user.email}</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-2 pt-0">
                            <p className="text-sm text-muted-foreground pb-2">
                                您已成功登录，欢迎使用 Cloud Claude ✨
                            </p>
                            <SignOutButton />
                        </CardContent>
                    </Card>
                ) : (
                    /* 未登录状态 */
                    <Card className="w-full shadow-lg">
                        <CardHeader className="pb-3 text-center">
                            <div className="flex justify-center mb-2">
                                <User className="size-8 text-muted-foreground" />
                            </div>
                            <CardTitle className="text-lg">开始使用</CardTitle>
                            <CardDescription>登录或注册以继续使用</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3 pt-0">
                            <Button id="home-sign-in-btn" asChild size="lg" className="w-full">
                                <Link href="/sign-in">登录</Link>
                            </Button>
                            <Button id="home-sign-up-btn" asChild size="lg" variant="outline" className="w-full">
                                <Link href="/sign-up">注册新账号</Link>
                            </Button>
                        </CardContent>
                    </Card>
                )}
            </main>
        </div>
    );
}
