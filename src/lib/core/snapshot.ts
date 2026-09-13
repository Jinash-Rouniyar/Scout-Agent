import { asc, eq, inArray } from "drizzle-orm";
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
  discoveredCompanies,
} from "@/lib/db/schema";
import { getAllEvents } from "./events";

/** Full run view assembled purely from persisted state (used by the run page,
 *  the polling fallback, and SSE clients rebuilding after refresh). */
export async function buildRunSnapshot(runId: string) {
  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (!run) return null;

  const [events, companyRows, allClaims, allDossiers, allSources] = await Promise.all([
    getAllEvents(runId),
    db.select().from(discoveredCompanies).where(eq(discoveredCompanies.runId, runId)).orderBy(asc(discoveredCompanies.rank)),
    db.select().from(claimsTable).where(eq(claimsTable.runId, runId)),
    db.select().from(dossiers).where(eq(dossiers.runId, runId)),
    db.select().from(sources).where(eq(sources.runId, runId)),
  ]);

  const entityIds = companyRows.map((c) => c.entityId).filter((e): e is string => Boolean(e));
  const [receiptRows, watchRows] = await Promise.all([
    entityIds.length ? db.select().from(actionReceipts).where(inArray(actionReceipts.entityId, entityIds)) : Promise.resolve([]),
    entityIds.length ? db.select().from(watches).where(inArray(watches.entityId, entityIds)) : Promise.resolve([]),
  ]);

  const claimsByEntity = groupBy(allClaims, (c) => c.entityId ?? "");
  const sourcesByEntity = groupBy(allSources, (s) => s.entityId ?? "");
  const dossierByEntity = new Map(allDossiers.map((d) => [d.entityId ?? "", d]));
  const receiptsByEntity = groupBy(receiptRows, (r) => r.entityId ?? "");
  const watchByEntity = new Map(watchRows.map((w) => [w.entityId, w]));

  const companies = companyRows.map((c) => {
    const eid = c.entityId ?? "";
    const claims = claimsByEntity.get(eid) ?? [];
    return {
      ...c,
      dossier: dossierByEntity.get(eid) ?? null,
      claims,
      sources: sourcesByEntity.get(eid) ?? [],
      receipts: receiptsByEntity.get(eid) ?? [],
      watch: watchByEntity.get(eid) ?? null,
    };
  });

  const lastSeq = events.length ? events[events.length - 1].seq : 0;

  // Legacy single-entity fields (still populated for non-thesis runs).
  const entity = run.entityId
    ? (await db.select().from(entities).where(eq(entities.id, run.entityId)).limit(1))[0] ?? null
    : null;
  const candidates = await db
    .select()
    .from(identityCandidates)
    .where(eq(identityCandidates.runId, runId))
    .orderBy(asc(identityCandidates.rank));

  return {
    run,
    companies,
    entity,
    candidates,
    claims: run.entityId ? (claimsByEntity.get(run.entityId) ?? allClaims) : allClaims,
    dossier: run.entityId ? dossierByEntity.get(run.entityId) ?? null : null,
    sources: allSources,
    receipts: receiptRows,
    watch: run.entityId ? watchByEntity.get(run.entityId) ?? null : null,
    events,
    lastSeq,
  };
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}

export type RunSnapshot = NonNullable<Awaited<ReturnType<typeof buildRunSnapshot>>>;
export type CompanyView = RunSnapshot["companies"][number];
