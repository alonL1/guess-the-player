import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

let cached:
  | {
      db: ReturnType<typeof drizzle<typeof schema>>;
      client: postgres.Sql;
    }
  | null = null;

export function getDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return null;
  }

  if (!cached) {
    const client = postgres(url, {
      prepare: false
    });

    cached = {
      client,
      db: drizzle(client, { schema })
    };
  }

  return cached;
}
