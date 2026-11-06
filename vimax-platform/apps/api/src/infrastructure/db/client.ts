import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { config } from "../../config/env.js";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!db) {
    const url = config.databaseUrl();
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    client = postgres(url, { max: 10 });
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

export { schema };
