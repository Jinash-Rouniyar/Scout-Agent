import { and, eq, lt } from "drizzle-orm";
import { sql as raw } from "drizzle-orm";
import { db, sql } from "@/lib/db/client";
import { cronLeases, cronRuns } from "@/lib/db/schema";
import { id } from "@/lib/util/ids";
import { requireEnv } from "@/env";

export const MONITOR_BATCH_LIMIT = 10;
export const MAX_ENTITY_RETRIES = 3;
const LEASE_MINUTES = 10;

/** Validate the Vercel cron secret (Authorization: Bearer <CRON_SECRET>). */
export function validateCronSecret(req: Request): boolean {
  const expected = requireEnv("CRON_SECRET");
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${expected}`;
}

/**
 * Acquire a self-expiring lease row for a cron kind. We deliberately avoid
 * Postgres session advisory locks: with Neon/Vercel transaction pooling a
 * single connection is not guaranteed to be held for the request, so an
 * advisory lock could be released early. The lease row is claimed atomically
 * via INSERT ... ON CONFLICT ... WHERE expires_at < now().
 */
export async function acquireLease(kind: string, holderId: string): Promise<boolean> {
  const rows = await sql<{ holder_id: string }[]>`
    INSERT INTO cron_leases (kind, holder_id, expires_at)
    VALUES (${kind}, ${holderId}, now() + (${LEASE_MINUTES} || ' minutes')::interval)
    ON CONFLICT (kind) DO UPDATE
      SET holder_id = EXCLUDED.holder_id, expires_at = EXCLUDED.expires_at
      WHERE cron_leases.expires_at < now()
    RETURNING holder_id
  `;
  return rows.length > 0 && rows[0].holder_id === holderId;
}

export async function releaseLease(kind: string, holderId: string): Promise<void> {
  await db.delete(cronLeases).where(and(eq(cronLeases.kind, kind), eq(cronLeases.holderId, holderId)));
}

/** UTC window key so a re-fired cron in the same window is a no-op via the
 *  unique (kind, scheduled_for) constraint. */
export function windowKey(kind: "monitor" | "recap", now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  if (kind === "recap") {
    // ISO week key for weekly recap.
    const week = isoWeek(now);
    return `${now.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return d;
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export interface CronRunHandle {
  id: string;
  fresh: boolean;
}

/**
 * Create or claim the persisted cron_run for this (kind, window). If a run for
 * this window already exists (Vercel fired twice), returns fresh=false so the
 * caller can no-op or resume.
 */
export async function claimCronRun(kind: "monitor" | "recap", scheduledFor: string): Promise<CronRunHandle> {
  const runId = id("cron");
  const inserted = await db
    .insert(cronRuns)
    .values({ id: runId, kind, scheduledFor, status: "running" })
    .onConflictDoNothing({ target: [cronRuns.kind, cronRuns.scheduledFor] })
    .returning({ id: cronRuns.id });

  if (inserted[0]) return { id: inserted[0].id, fresh: true };

  const [existing] = await db
    .select()
    .from(cronRuns)
    .where(and(eq(cronRuns.kind, kind), eq(cronRuns.scheduledFor, scheduledFor)))
    .limit(1);
  return { id: existing.id, fresh: false };
}

export async function finishCronRun(cronRunId: string, status: "completed" | "failed", result: unknown, processed: number): Promise<void> {
  await db
    .update(cronRuns)
    .set({ status, result: (result ?? null) as object, processed, finishedAt: new Date() })
    .where(eq(cronRuns.id, cronRunId));
}

export { raw, lt };
