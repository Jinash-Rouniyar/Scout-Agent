import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  scoutRuns,
  entities,
  identityCandidates,
  claims as claimsTable,
  dossiers,
  sources,
  actionReceipts,
  watches,
} from "@/lib/db/schema";
import { getAllEvents } from "./events";

/** Full run view assembled purely from persisted state (used by the run page,
 *  the polling fallback, and SSE clients rebuilding after refresh). */
export async function buildRunSnapshot(runId: string) {
  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (!run) return null;

  const entity = run.entityId
    ? (await db.select().from(entities).where(eq(entities.id, run.entityId)).limit(1))[0] ?? null
    : null;

  const [candidates, claims, [dossier], srcs, receipts, events, [watch]] = await Promise.all([
    db.select().from(identityCandidates).where(eq(identityCandidates.runId, runId)).orderBy(asc(identityCandidates.rank)),
    db.select().from(claimsTable).where(eq(claimsTable.runId, runId)),
    db.select().from(dossiers).where(eq(dossiers.runId, runId)).limit(1),
    db.select().from(sources).where(eq(sources.runId, runId)),
    db.select().from(actionReceipts).where(run.entityId ? eq(actionReceipts.entityId, run.entityId) : eq(actionReceipts.entityId, "__none__")),
    getAllEvents(runId),
    run.entityId ? db.select().from(watches).where(eq(watches.entityId, run.entityId)).limit(1) : Promise.resolve([]),
  ]);

  const lastSeq = events.length ? events[events.length - 1].seq : 0;

  return {
    run,
    entity,
    candidates,
    claims,
    dossier: dossier ?? null,
    sources: srcs,
    receipts,
    watch: watch ?? null,
    events,
    lastSeq,
  };
}

export type RunSnapshot = NonNullable<Awaited<ReturnType<typeof buildRunSnapshot>>>;
