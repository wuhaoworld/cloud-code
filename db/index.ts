import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';

const isProduction = !!process.env.TURSO_DATABASE_URL;

export const db = isProduction
  ? // 生产环境：Turso 云数据库
    drizzle({
      connection: {
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      },
    })
  : // 本地开发：SQLite 文件
    drizzle({
      connection: {
        url: process.env.DB_FILE_NAME ?? 'file:.data/app.db',
      },
    });