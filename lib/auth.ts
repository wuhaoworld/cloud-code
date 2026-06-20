import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/auth-schema";

export const auth = betterAuth({
    appName: "Cloud Claude",
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
        sendResetPassword: async ({ user, url }) => {
            // Mock: 在生产环境中替换为真实邮件发送逻辑
            console.log(`[Password Reset] To: ${user.email}, URL: ${url}`);
        },
    },
    database: drizzleAdapter(db, {
        provider: "sqlite",
        schema,
    }),
    plugins: [
        nextCookies(), // 必须放在最后
    ],
});

export type Session = typeof auth.$Infer.Session;