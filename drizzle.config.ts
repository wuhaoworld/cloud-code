import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const isProduction = !!process.env.TURSO_DATABASE_URL;

export default defineConfig({
  out: './drizzle',
  schema: ['./db/schema.ts', './db/auth-schema.ts'],
  ...(isProduction
    ? // 生产环境：Turso 云数据库
      {
        dialect: 'turso' as const,
        dbCredentials: {
          url: process.env.TURSO_DATABASE_URL!,
          authToken: process.env.TURSO_AUTH_TOKEN!,
        },
      }
    : // 本地开发：SQLite 文件
      {
        dialect: 'sqlite' as const,
        dbCredentials: {
          url: process.env.DB_FILE_NAME ?? 'file:.data/app.db',
        },
      }),
});
