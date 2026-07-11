import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';

// export const db = drizzle(process.env.DB_FILE_NAME!);

export const db = drizzle({ 
  connection: { 
    url: process.env.TURSO_DATABASE_URL!, 
    authToken: process.env.TURSO_AUTH_TOKEN!
  }
});