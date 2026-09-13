import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  scoutRuns,
  entities,
  claims as claimsTable,
  sources as sourcesTable,
  dossiers,
  watches,
  snapshots,
  runEvents,
  discoveredCompanies,
} from "@/lib/db/schema";
import { executeRun } from "@/lib/core/pipeline";
import { createCompanyDiligence } from "@/lib/core/writer";
import { monitorEntity } from "@/lib/core/monitoring";
import { makeFixtureConnectors, type WriteLog } from "@/lib/connectors/fixtures";
import { id } from "@/lib/util/ids";
import { startTrace } from "@/lib/observability/langfuse";
import type { Scenario, Trajectory } from "./types";

const RESEARCH_DEADLINE_MS = 180_000;

/** Run one trial. Connectors are mocked; Claude, validators, scoring, and
 *  monitoring run for real on the thesis pipeline. */
export async function runTrial(scenario: Scenario): Promise<Trajectory> {
  const { connectors, writes } = makeFixtureConnectors(scenario.fixtures);
  const trace = startTrace("eval-scenario", { scenario: scenario.id, family: scenario.family });

  try {
    if (scenario.kind === "monitoring") {
      const t = await runMonitoringTrial(scenario, connectors, writes);
      t.traceId = trace.id;
      return t;
    }
    if (scenario.kind === "duplicate_write") {
      const t = await runDuplicateWriteTrial(scenario, connectors, writes, trace);
      t.traceId = trace.id;
      return t;
    }
    const t = await runThesisTrial(scenario, connectors, writes, trace);
    t.traceId = trace.id;
    return t;
  } finally {
    await trace.end().catch(() => {});
  }
}

async function runThesisTrial(
  scenario: Scenario,
  connectors: ReturnType<typeof makeFixtureConnectors>["connectors"],
  writes: WriteLog[],
  trace: ReturnType<typeof startTrace>,
): Promise<Trajectory> {
  const runId = id("evalrun");
  const thesis = scenario.thesis ?? scenario.input;

  if (scenario.kind === "thesis_diligence" && scenario.seedCompany) {
    const seed = scenario.seedCompany;
    await db.insert(scoutRuns).values({
      id: runId,
      input: thesis,
      inputKind: "thesis",
      thesis,
      state: "RESEARCHING",
    });
    await db.insert(discoveredCompanies).values({
      id: id("cmp"),
      runId,
      rank: 1,
      name: seed.name,
      domain: seed.domain ?? null,
      githubOrg: seed.githubOrg ?? null,
      oneLiner: seed.oneLiner,
      whyMatch: seed.whyMatch,
      selected: true,
      optSlack: seed.optSlack ?? false,
      optEmail: seed.optEmail ?? false,
      optNotion: seed.optNotion ?? false,
      status: "pending",
    });
  } else {
    await db.insert(scoutRuns).values({
      id: runId,
      input: thesis,
      inputKind: "thesis",
      thesis,
      state: "CREATED",
    });
  }

  await executeRun(runId, { connectors, deadline: Date.now() + RESEARCH_DEADLINE_MS, trace });
  return buildThesisTrajectory(runId, scenario, writes);
}

async function runDuplicateWriteTrial(
  scenario: Scenario,
  connectors: ReturnType<typeof makeFixtureConnectors>["connectors"],
  writes: WriteLog[],
  trace: ReturnType<typeof startTrace>,
): Promise<Trajectory> {
  if (!process.env.SLACK_CHANNEL_ID) process.env.SLACK_CHANNEL_ID = "C_EVAL";

  const runId = id("evalrun");
  const entityId = id("evalent");
  const thesis = scenario.thesis ?? scenario.input;

  await db.insert(entities).values({
    id: entityId,
    kind: "company",
    canonicalName: "Pack Co",
    companyGithubOrg: "pack-dev",
    identityConfidence: 1,
    resolvedAt: new Date(),
  });
  await db.insert(scoutRuns).values({
    id: runId,
    input: thesis,
    inputKind: "thesis",
    thesis,
    state: "COMPLETED",
  });
  await db.insert(dossiers).values({
    id: id("dossier"),
    runId,
    entityId,
    whyNow: "Shipped a public platform with recent releases.",
    summary: "Pack Co is an early developer-infrastructure company.",
    opportunityScore: 70,
    confidenceScore: 65,
    label: "Promising",
    timeline: [],
  });
  await db.insert(claimsTable).values({
    id: id("claim"),
    runId,
    entityId,
    category: "fact",
    text: "Public GitHub org pack-dev ships an open-source platform.",
    sourceIds: [],
    status: "validated",
  });
  await db.insert(discoveredCompanies).values({
    id: id("cmp"),
    runId,
    rank: 1,
    name: "Pack Co",
    githubOrg: "pack-dev",
    oneLiner: "Developer platform",
    whyMatch: "Open-source traction",
    selected: true,
    optSlack: true,
    optNotion: true,
    optEmail: false,
    entityId,
    status: "ready",
  });

  await createCompanyDiligence({
    runId,
    entityId,
    thesis,
    options: { slack: true, email: false, notion: true },
    connectors,
    trace,
  });
  await createCompanyDiligence({
    runId,
    entityId,
    thesis,
    options: { slack: true, email: false, notion: true },
    connectors,
    trace,
  });

  return {
    ...writeTrajectory(writes),
    toolCalls: [],
    storedSourceUrls: [],
    claims: [],
    validationOk: true,
    discoveredCompanies: [{ name: "Pack Co", status: "ready" }],
    finalState: "COMPLETED",
  };
}

async function buildThesisTrajectory(runId: string, scenario: Scenario, writes: WriteLog[]): Promise<Trajectory> {
  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  const evs = await db.select().from(runEvents).where(eq(runEvents.runId, runId));
  const toolCalls = evs
    .filter((e) => e.type === "tool.call" || e.type === "discovery.tool")
    .map((e) => (e.payload as { name?: string } | null)?.name)
    .filter((n): n is string => Boolean(n));
  const srcs = await db.select().from(sourcesTable).where(eq(sourcesTable.runId, runId));
  const storedIds = new Set(srcs.map((s) => s.id));
  const claimRows = await db.select().from(claimsTable).where(eq(claimsTable.runId, runId));
  const companies = await db.select().from(discoveredCompanies).where(eq(discoveredCompanies.runId, runId));
  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.runId, runId)).limit(1);
  const breakdown = (dossier?.scoreBreakdown as { opportunity?: { riskPenalty?: number } } | null) ?? null;

  const claims = claimRows.map((c) => ({
    category: c.category as Trajectory["claims"][number]["category"],
    text: c.text,
    grounded:
      c.category !== "fact" ||
      ((c.sourceIds ?? []).length > 0 && (c.sourceIds ?? []).every((s) => storedIds.has(s))),
  }));

  let behavior: Trajectory["behavior"];
  if (run.state === "AWAITING_SELECTION") behavior = "awaiting_selection";
  else if (scenario.family === "prompt_injection") behavior = "ignore_injection";
  else if (companies.some((c) => c.status === "ready")) behavior = "auto_research";
  else if (companies.some((c) => c.status === "failed") || run.state === "REVIEW_NEEDED") behavior = "insufficient_evidence";

  return {
    toolCalls,
    storedSourceUrls: srcs.map((s) => s.url),
    claims,
    validationOk: claims.every((c) => c.grounded),
    opportunity: dossier?.opportunityScore ?? undefined,
    confidence: dossier?.confidenceScore ?? undefined,
    riskPenalty: breakdown?.opportunity?.riskPenalty,
    ...writeTrajectory(writes),
    discoveredCompanies: companies.map((c) => ({ name: c.name, status: c.status })),
    finalState: run.state,
    behavior,
    error: run.error ?? undefined,
  };
}

function writeTrajectory(writes: WriteLog[]): Pick<Trajectory, "writes" | "duplicateWriteDetected"> {
  const seen = new Map<string, Set<string>>();
  for (const w of writes) {
    const key = `${w.app}:${w.method}`;
    const set = seen.get(key) ?? new Set();
    set.add(w.externalId);
    seen.set(key, set);
  }
  return {
    writes: writes.map((w) => ({ app: w.app, method: w.method, externalId: w.externalId })),
    duplicateWriteDetected: [...seen.values()].some((s) => s.size > 1),
  };
}

async function runMonitoringTrial(
  scenario: Scenario,
  connectors: ReturnType<typeof makeFixtureConnectors>["connectors"],
  writes: WriteLog[],
): Promise<Trajectory> {
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
  const second = await monitorEntity(watch, connectors);

  return {
    toolCalls: [],
    storedSourceUrls: [],
    claims: [],
    validationOk: true,
    ...writeTrajectory(writes),
    duplicateWriteDetected: second.wrote > 0,
    signals: first.detected.map((d) => ({ kind: d.kind, materiality: d.materiality })),
    finalState: "WATCHING",
  };
}
