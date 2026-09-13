import { db, sql } from "@/lib/db/client";
import {
  scoutRuns,
  entities,
  sources,
  claims,
  dossiers,
  watches,
  signalEvents,
  runEvents,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stableKey } from "@/lib/util/ids";

/**
 * Seed a completed, cached research trace for the demo so the rich dossier and
 * watchlist render instantly without live cold-search latency. Idempotent:
 * re-running replaces the demo rows.
 */
const RUN_ID = "run_demo_alice";
const ENTITY_ID = "ent_demo_alice";
const WATCH_ID = "watch_demo_alice";

async function reset() {
  await db.delete(runEvents).where(eq(runEvents.runId, RUN_ID));
  await db.delete(signalEvents).where(eq(signalEvents.entityId, ENTITY_ID));
  await db.delete(watches).where(eq(watches.id, WATCH_ID));
  await db.delete(dossiers).where(eq(dossiers.runId, RUN_ID));
  await db.delete(claims).where(eq(claims.runId, RUN_ID));
  await db.delete(sources).where(eq(sources.runId, RUN_ID));
  await db.delete(scoutRuns).where(eq(scoutRuns.id, RUN_ID));
  await db.delete(entities).where(eq(entities.id, ENTITY_ID));
}

async function main() {
  await reset();

  await db.insert(entities).values({
    id: ENTITY_ID,
    kind: "person",
    canonicalName: "Alice AI",
    githubLogin: "alice-ai",
    linkedGithubAccounts: ["alice-ai"],
    companyDomain: "alice-ai.dev",
    identityConfidence: 1,
    resolvedAt: new Date(),
  });

  await db.insert(scoutRuns).values({
    id: RUN_ID,
    input: "https://github.com/alice-ai",
    inputKind: "github_url",
    thesis: "AI infrastructure, early stage, open-source traction",
    state: "WATCHING",
    entityId: ENTITY_ID,
    model: "claude-sonnet-5",
    toolCallCount: 6,
    docFetchCount: 5,
    startedAt: new Date(Date.now() - 86400000),
    finishedAt: new Date(Date.now() - 86000000),
  });

  const src = [
    { id: "src_demo_profile", url: "https://github.com/alice-ai", sourceType: "github", tier: "primary", title: "GitHub profile @alice-ai", excerpt: "Building open AI infra" },
    { id: "src_demo_repo", url: "https://github.com/alice-ai/vector-engine", sourceType: "github", tier: "primary", title: "alice-ai/vector-engine", excerpt: "High-performance vector search — 8.2k stars" },
    { id: "src_demo_web", url: "https://techblog.example.com/alice-ai-vector", sourceType: "web", tier: "contextual", title: "Alice AI's vector engine gains traction", excerpt: "Independent coverage of growing adoption." },
  ];
  for (const s of src) {
    await db.insert(sources).values({
      id: s.id,
      runId: RUN_ID,
      entityId: ENTITY_ID,
      url: s.url,
      sourceType: s.sourceType,
      tier: s.tier,
      title: s.title,
      excerpt: s.excerpt,
      contentHash: stableKey(s.url, s.title),
    });
  }

  const claimRows = [
    { id: "clm_demo_1", category: "fact", text: "Maintains alice-ai/vector-engine, an open-source vector search project with 8.2k stars.", sourceIds: ["src_demo_repo"] },
    { id: "clm_demo_2", category: "fact", text: "Shipped release v2.1.0 within the last week.", sourceIds: ["src_demo_repo"] },
    { id: "clm_demo_3", category: "interpretation", text: "Sustained shipping plus external adoption suggests strong technical execution.", sourceIds: ["src_demo_repo", "src_demo_web"] },
    { id: "clm_demo_4", category: "risk", text: "Single flagship project; concentration risk if adoption stalls.", sourceIds: ["src_demo_repo"] },
    { id: "clm_demo_5", category: "open_question", text: "Is there a company entity and commercial traction beyond the open-source project?", sourceIds: [] },
  ];
  for (const c of claimRows) {
    await db.insert(claims).values({
      id: c.id,
      runId: RUN_ID,
      entityId: ENTITY_ID,
      category: c.category,
      text: c.text,
      sourceIds: c.sourceIds,
      status: "validated",
    });
  }

  await db.insert(dossiers).values({
    id: "dossier_demo_alice",
    runId: RUN_ID,
    entityId: ENTITY_ID,
    whyNow: "Rapidly growing open-source AI-infra project with a fresh release and independent coverage.",
    summary: "Alice AI maintains a widely adopted vector search engine (8.2k stars) with sustained releases and external contributors, matching an AI-infrastructure thesis.",
    opportunityScore: 82,
    confidenceScore: 71,
    scoreBreakdown: {
      opportunity: { base: 88.75, riskPenalty: 5, opportunity: 82, label: "High conviction" },
      confidenceInputs: { sourceQuality: 80, corroboration: 70, recency: 70, entityResolutionCertainty: 60 },
    },
    label: "High conviction",
    timeline: [
      { date: "2026-09-05", text: "vector-engine crossed 8k stars" },
      { date: "2026-09-08", text: "Release v2.1.0 published" },
    ],
  });

  await db.insert(watches).values({
    id: WATCH_ID,
    entityId: ENTITY_ID,
    runId: RUN_ID,
    active: true,
    notionPageId: "notion_demo_alice",
    slackThreadTs: "1699999999.000100",
    watchStart: new Date(Date.now() - 7 * 86400000),
    lastCheckedAt: new Date(),
  });

  await db.insert(signalEvents).values([
    {
      id: "sig_demo_release",
      entityId: ENTITY_ID,
      watchId: WATCH_ID,
      kind: "release",
      source: "github",
      eventTime: new Date(Date.now() - 86400000),
      materiality: 70,
      assessment: "New tagged release v2.1.0 on alice-ai/vector-engine.",
      citationUrl: "https://github.com/alice-ai/vector-engine/releases/tag/v2.1.0",
      dedupeKey: stableKey(ENTITY_ID, "release", "alice-ai/vector-engine", "v2.1.0"),
    },
    {
      id: "sig_demo_noise",
      entityId: ENTITY_ID,
      watchId: WATCH_ID,
      kind: "noise",
      source: "github",
      eventTime: new Date(Date.now() - 2 * 86400000),
      materiality: 20,
      assessment: "Routine documentation commits (stored silently).",
      dedupeKey: stableKey(ENTITY_ID, "noise", "docs"),
    },
  ]);

  // Persisted event history so the run page replays a rich trace on load.
  const events: Array<[string, unknown]> = [
    ["run.created", { input: "https://github.com/alice-ai", inputKind: "github_url" }],
    ["state.changed", { from: "CREATED", to: "RESOLVING_IDENTITY" }],
    ["identity.confirmed", { entityId: ENTITY_ID, auto: true, confidence: 1 }],
    ["state.changed", { from: "RESOLVING_IDENTITY", to: "RESEARCHING" }],
    ["tool.call", { name: "github_get_profile", toolCalls: 1 }],
    ["source.stored", { url: "https://github.com/alice-ai", type: "github", tier: "primary" }],
    ["tool.call", { name: "github_list_repos", toolCalls: 2 }],
    ["tool.call", { name: "github_get_repo", toolCalls: 3 }],
    ["source.stored", { url: "https://github.com/alice-ai/vector-engine", type: "github", tier: "primary" }],
    ["tool.call", { name: "web_search", toolCalls: 4 }],
    ["tool.call", { name: "fetch_url", toolCalls: 5 }],
    ["source.stored", { url: "https://techblog.example.com/alice-ai-vector", type: "web", tier: "contextual" }],
    ["validation.result", { ok: true, stats: { facts: 2, ungroundedFacts: 0 } }],
    ["synthesis.completed", { opportunity: 82, confidence: 71, label: "High conviction" }],
    ["state.changed", { from: "VALIDATING", to: "READY_FOR_REVIEW" }],
    ["dossier.ready", { opportunity: 82, confidence: 71, label: "High conviction" }],
    ["action.receipt", { app: "notion", action: "notion_page", result: "success", externalObjectId: "notion_demo_alice", reused: false }],
    ["action.receipt", { app: "google_docs", action: "google_doc", result: "success", externalObjectId: "doc_demo_alice", reused: false }],
    ["action.receipt", { app: "slack", action: "slack_thread", result: "success", externalObjectId: "1699999999.000100", reused: false }],
    ["signal.detected", { note: "watch active", watching: true }],
  ];
  for (const [type, payload] of events) {
    await db.insert(runEvents).values({ runId: RUN_ID, type, payload: payload as object });
  }

  console.log(`Seeded demo run ${RUN_ID} (Alice AI) in WATCHING state with dossier, watch, and signals.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});
