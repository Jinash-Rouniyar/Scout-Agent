import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

/**
 * Postgres connection.
 *
 * Uses postgres.js against a (typically Neon) pooled connection string. We do
 * NOT rely on session-bound advisory locks for cron single-flight because a
 * pooled/serverless connection is not guaranteed to be held for the duration
 * of a request; the cron lease row (see core/cron.ts) is the coordination
 * primitive instead.
 */
declare global {
  // eslint-disable-next-line no-var
  var __scoutSql: ReturnType<typeof postgres> | undefined;
}

function makeClient() {
  return postgres(env().DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    prepare: false, // safe with transaction-pooled connections
  });
}

export const sql = global.__scoutSql ?? makeClient();
if (process.env.NODE_ENV !== "production") global.__scoutSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
