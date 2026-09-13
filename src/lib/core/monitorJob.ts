import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { watches } from "@/lib/db/schema";
import type { Connectors } from "@/lib/connectors/types";
import { liveConnectors } from "@/lib/connectors/registry";
import { id } from "@/lib/util/ids";
import {
  acquireLease,
  claimCronRun,
  finishCronRun,
  MAX_ENTITY_RETRIES,
  MONITOR_BATCH_LIMIT,
  releaseLease,
  windowKey,
} from "./cron";
import { monitorEntity } from "./monitoring";
import { startTrace } from "@/lib/observability/langfuse";

export interface MonitorBatchSummary {
  ran: boolean;
  reason?: string;
  cronRunId?: string;
  processed: number;
  material: number;
  perEntity: Array<{ entityId: string; wrote: number; detected: number; degraded: string[]; error?: string }>;
}

/**
 * Bounded daily monitoring batch. Cron ONLY runs bounded monitoring — it never
 * re-runs full deep diligence. Durability contract:
 *  - single-flight via cron lease
 *  - persisted cron_run per UTC window (no-op on double fire)
 *  - <=10 entities, each persisted before the next
 *  - failed entity retried at most 3 times, then marked terminal + visible
 *  - all writes idempotent via action_receipts
 */
export async function runMonitorBatch(connectors: Connectors = liveConnectors()): Promise<MonitorBatchSummary> {
  const holderId = id("holder");
  const kind = "monitor" as const;

  if (!(await acquireLease(kind, holderId))) {
    return { ran: false, reason: "lease-held", processed: 0, material: 0, perEntity: [] };
  }

  try {
    const scheduledFor = windowKey(kind);
    const cronRun = await claimCronRun(kind, scheduledFor);
    if (!cronRun.fresh) {
      return { ran: false, reason: "window-already-processed", cronRunId: cronRun.id, processed: 0, material: 0, perEntity: [] };
    }

    // Oldest-checked active, non-terminal watches first, bounded to the batch limit.
    const batch = await db
      .select()
      .from(watches)
      .where(and(eq(watches.active, true), eq(watches.terminalFailure, false)))
      .orderBy(asc(watches.lastCheckedAt))
      .limit(MONITOR_BATCH_LIMIT);

    const perEntity: MonitorBatchSummary["perEntity"] = [];
    let material = 0;

    const trace = startTrace("scout.monitor", { window: scheduledFor, batch: batch.length });

    for (const watch of batch) {
      const span = trace.span("monitor-entity", { entityId: watch.entityId });
      try {
        const result = await monitorEntity(watch, connectors);
        material += result.wrote;
        span.end({ detected: result.detected.length, wrote: result.wrote, degraded: result.degraded });
        // Success resets the retry counter.
        await db.update(watches).set({ failureCount: 0 }).where(eq(watches.id, watch.id));
        perEntity.push({ entityId: result.entityId, wrote: result.wrote, detected: result.detected.length, degraded: result.degraded });
      } catch (e) {
        const message = e instanceof Error ? e.message : "monitor-error";
        const nextCount = watch.failureCount + 1;
        const terminal = nextCount >= MAX_ENTITY_RETRIES;
        await db
          .update(watches)
          .set({ failureCount: nextCount, terminalFailure: terminal })
          .where(eq(watches.id, watch.id));
        span.end({ error: message, terminal });
        perEntity.push({ entityId: watch.entityId, wrote: 0, detected: 0, degraded: [], error: `${message}${terminal ? " (terminal)" : ` (retry ${nextCount}/${MAX_ENTITY_RETRIES})`}` });
      }
      // Persist progress incrementally (cursor) before the next entity.
      await finishCronRunProgress(cronRun.id, perEntity.length);
    }

    await trace.end();
    await finishCronRun(cronRun.id, "completed", { perEntity, material }, perEntity.length);
    return { ran: true, cronRunId: cronRun.id, processed: perEntity.length, material, perEntity };
  } finally {
    await releaseLease(kind, holderId);
  }
}

async function finishCronRunProgress(cronRunId: string, cursor: number): Promise<void> {
  const { cronRuns } = await import("@/lib/db/schema");
  await db.update(cronRuns).set({ cursor, processed: cursor }).where(eq(cronRuns.id, cronRunId));
}
