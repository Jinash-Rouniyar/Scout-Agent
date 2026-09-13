import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  scoutRuns,
  entities,
  identityCandidates,
  claims as claimsTable,
  sources as sourcesTable,
  dossiers,
  watches,
  snapshots,
  runEvents,
} from "@/lib/db/schema";
import { detectInputKind } from "@/lib/core/input";
import { executeRun } from "@/lib/core/pipeline";
import { createDiligencePack } from "@/lib/core/writer";
import { monitorEntity } from "@/lib/core/monitoring";
import { makeFixtureConnectors, type WriteLog } from "@/lib/connectors/fixtures";
import { id } from "@/lib/util/ids";
import { startTrace } from "@/lib/observability/langfuse";
import type { Scenario, Trajectory } from "./types";

/** Run one real trial for a scenario. Connectors are mocked; the Scout agent,
 *  Claude Sonnet 5, validators, scoring, and monitoring all run for real. */
export async function runTrial(scenario: Scenario): Promise<Trajectory> {
  const { connectors, writes } = makeFixtureConnectors(scenario.fixtures);
  const trace = startTrace("eval-scenario", { scenario: scenario.id, family: scenario.family });

  try {
    if (scenario.kind === "monitoring") {
      const t = await runMonitoringTrial(scenario, connectors, writes);
      t.traceId = trace.id;
      return t;
    }
    const t = await runResearchTrial(scenario, connectors, writes, trace);
    t.traceId = trace.id;
    return t;
  } finally {
    await trace.end().catch(() => {});
  }
}

async function runResearchTrial(
  scenario: Scenario,
  connectors: ReturnType<typeof makeFixtureConnectors>["connectors"],
  writes: WriteLog[],
  trace: ReturnType<typeof startTrace>,
): Promise<Trajectory> {
  const runId = id("evalrun");
  await db.insert(scoutRuns).values({
    id: runId,
    input: scenario.input,
    inputKind: detectInputKind(scenario.input),
    thesis: scenario.thesis ?? null,
    state: "CREATED",
  });

  await executeRun(runId, { connectors, deadline: Date.now() + 120_000, trace });

  // Duplicate-write scenario: approve the pack TWICE with the same connectors.
  if (scenario.kind === "duplicate_write") {
    const [afterResearch] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
    if (afterResearch.state === "READY_FOR_REVIEW") {
      await createDiligencePack(runId, connectors);
      await createDiligencePack(runId, connectors); // second attempt must reuse receipts
      await db.update(scoutRuns).set({ state: "WATCHING" }).where(eq(scoutRuns.id, runId));
    }
  }

  return buildResearchTrajectory(runId, scenario, writes);
}

async function buildResearchTrajectory(runId: string, scenario: Scenario, writes: WriteLog[]): Promise<Trajectory> {
  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  const evs = await db.select().from(runEvents).where(eq(runEvents.runId, runId));
  const toolCalls = evs
    .filter((e) => e.type === "tool.call")
    .map((e) => (e.payload as { name?: string } | null)?.name)
    .filter((n): n is string => Boolean(n));
  const srcs = await db.select().from(sourcesTable).where(eq(sourcesTable.runId, runId));
  const storedIds = new Set(srcs.map((s) => s.id));
  const claimRows = await db.select().from(claimsTable).where(eq(claimsTable.runId, runId));
  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.runId, runId)).limit(1);
  const cands = await db.select().from(identityCandidates).where(eq(identityCandidates.runId, runId));

  const claims = claimRows.map((c) => ({
    category: c.category as Trajectory["claims"][number]["category"],
    text: c.text,
    grounded: c.category !== "fact" || ((c.sourceIds ?? []).length > 0 && (c.sourceIds ?? []).every((s) => storedIds.has(s))),
  }));

  // Duplicate detection: >1 external id for the same app+method.
  const seen = new Map<string, Set<string>>();
  for (const w of writes) {
    const key = `${w.app}:${w.method}`;
    const set = seen.get(key) ?? new Set();
    set.add(w.externalId);
    seen.set(key, set);
  }
  const duplicateWriteDetected = [...seen.values()].some((s) => s.size > 1);

  const breakdown = (dossier?.scoreBreakdown as { opportunity?: { riskPenalty?: number } } | null) ?? null;

  let behavior: Trajectory["behavior"];
  if (run.state === "RESOLVING_IDENTITY" && cands.length > 0) behavior = "needs_confirmation";
  else if (scenario.family === "prompt_injection") behavior = "ignore_injection";
  else if (run.state === "READY_FOR_REVIEW" || run.state === "WATCHING") behavior = "auto_research";
  else if (run.state === "REVIEW_NEEDED") behavior = "insufficient_evidence";

  return {
    toolCalls,
    storedSourceUrls: srcs.map((s) => s.url),
    claims,
    validationOk: claims.every((c) => c.grounded),
    opportunity: dossier?.opportunityScore ?? undefined,
    confidence: dossier?.confidenceScore ?? undefined,
    riskPenalty: breakdown?.opportunity?.riskPenalty,
    writes: writes.map((w) => ({ app: w.app, method: w.method, externalId: w.externalId })),
    duplicateWriteDetected,
    finalState: run.state,
    behavior,
    error: run.error ?? undefined,
  };
}

async function runMonitoringTrial(scenario: Scenario, connectors: ReturnType<typeof makeFixtureConnectors>["connectors"], writes: WriteLog[]): Promise<Trajectory> {
  const m = scenario.monitoring!;
  const entityId = id("evalent");
  await db.insert(entities).values({
    id: entityId,
    kind: m.entity.kind,
    canonicalName: m.entity.canonicalName,
    githubLogin: m.entity.githubLogin,
    linkedGithubAccounts: m.entity.linkedGithubAccounts ?? (m.entity.githubLogin ? [m.entity.githubLogin] : []),
    companyDomain: m.entity.companyDomain,
    companyGithubOrg: m.entity.companyGithubOrg,
    identityConfidence: 1,
    resolvedAt: new Date(),
  });

  const watchId = id("evalwatch");
  await db.insert(watches).values({
    id: watchId,
    entityId,
    active: true,
    watchStart: new Date(Date.now() - m.watchStartDaysAgo * 86400000),
    notionPageId: m.withThreadAndPage ? `notion_eval_${entityId}` : null,
    slackThreadTs: m.withThreadAndPage ? `slackts_eval_${entityId}` : null,
  });

  // Seed the 7-day baseline snapshot.
  if (m.baselineGithub && m.baselineDaysAgo) {
    await db.insert(snapshots).values({
      id: id("snap"),
      entityId,
      source: "github",
      capturedAt: new Date(Date.now() - m.baselineDaysAgo * 86400000),
      data: m.baselineGithub as object,
      contentHash: "baseline",
    });
  }

  const [watch] = await db.select().from(watches).where(eq(watches.id, watchId)).limit(1);
  const first = await monitorEntity(watch, connectors);
  // Second run must be a no-op for writes (dedupe / idempotency).
  const second = await monitorEntity(watch, connectors);

  return {
    toolCalls: [],
    storedSourceUrls: [],
    claims: [],
    validationOk: true,
    writes: writes.map((w) => ({ app: w.app, method: w.method, externalId: w.externalId })),
    duplicateWriteDetected: second.wrote > 0,
    signals: first.detected.map((d) => ({ kind: d.kind, materiality: d.materiality })),
    finalState: "WATCHING",
  };
}
