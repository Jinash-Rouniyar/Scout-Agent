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
  discoveredCompanies,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stableKey } from "@/lib/util/ids";

/**
 * Seed a completed thesis run for the demo so the discovery -> selection ->
 * diligence flow renders instantly with rich per-company results. Idempotent.
 */
const RUN_ID = "run_demo_thesis";
const THESIS = "Pre-seed founders building developer infrastructure for AI agents, with meaningful open-source traction.";

interface DemoCompany {
  entityId: string;
  cmpId: string;
  watchId: string;
  rank: number;
  name: string;
  domain: string;
  githubOrg: string;
  oneLiner: string;
  whyMatch: string;
  opportunity: number;
  confidence: number;
  label: string;
  whyNow: string;
  summary: string;
  docId: string;
  notionPageId: string;
  slackThreadTs: string;
  claims: { category: string; text: string }[];
}

const COMPANIES: DemoCompany[] = [
  {
    entityId: "ent_demo_lemma",
    cmpId: "cmp_demo_lemma",
    watchId: "watch_demo_lemma",
    rank: 1,
    name: "Lemma",
    domain: "uselemma.ai",
    githubOrg: "uselemma",
    oneLiner: "Production monitoring & observability for AI agents — catches silent failures and triages them to Slack.",
    whyMatch: "Pre-seed, developer infrastructure squarely for AI agents, with a public GitHub org and client tooling.",
    opportunity: 61,
    confidence: 73,
    label: "Watch",
    whyNow:
      "Just closed a $2.3M pre-seed with a notable syndicate and named customers, indicating early commercial pull in the fast-growing AI agent observability category.",
    summary:
      "Lemma is a YC F25 startup building production monitoring for AI agents. Real funding and named customers, but traction is largely self-reported and the public open-source footprint is thin.",
    docId: "doc_demo_lemma",
    notionPageId: "notion_demo_lemma",
    slackThreadTs: "1789327724.484359",
    claims: [
      { category: "fact", text: "Production monitoring/observability platform for AI agents, surfacing 'silent failures' with Slack alerts and an MCP integration." },
      { category: "fact", text: "Announced a $2.3M pre-seed round backed by a multi-fund syndicate plus operator angels." },
      { category: "interpretation", text: "Thin public GitHub footprint relative to funding suggests a closed-source SaaS exposing only client tooling." },
      { category: "risk", text: "Traction claims (MRR growth, customer count) are self-reported and unverified by third parties." },
      { category: "open_question", text: "No independently verified revenue or customer-count figures were found." },
    ],
  },
  {
    entityId: "ent_demo_orbital",
    cmpId: "cmp_demo_orbital",
    watchId: "watch_demo_orbital",
    rank: 2,
    name: "Orbital Agents",
    domain: "orbital.dev",
    githubOrg: "orbital-labs",
    oneLiner: "Open-source runtime and eval harness for long-running autonomous agents.",
    whyMatch: "Open-source-first developer infrastructure for AI agents with a fast-growing GitHub community.",
    opportunity: 78,
    confidence: 68,
    label: "Promising",
    whyNow:
      "Open-source runtime crossed 6k stars in three months with a v0.4 release and multiple external contributors — measurable community momentum.",
    summary:
      "Orbital Agents ships an open-source agent runtime with an eval harness. Strong developer traction and sustained releases; commercial model is still early.",
    docId: "doc_demo_orbital",
    notionPageId: "notion_demo_orbital",
    slackThreadTs: "1789327725.221100",
    claims: [
      { category: "fact", text: "Maintains an open-source agent runtime that crossed 6,000 GitHub stars." },
      { category: "fact", text: "Published a v0.4 release within the last month with contributions from outside the core team." },
      { category: "interpretation", text: "Sustained releases plus external contributors indicate credible technical execution and genuine adoption." },
      { category: "risk", text: "No public pricing or commercial offering yet; monetization path is unproven." },
      { category: "open_question", text: "Team size and funding status could not be independently confirmed." },
    ],
  },
];

async function reset() {
  await db.delete(runEvents).where(eq(runEvents.runId, RUN_ID));
  await db.delete(discoveredCompanies).where(eq(discoveredCompanies.runId, RUN_ID));
  await db.delete(dossiers).where(eq(dossiers.runId, RUN_ID));
  await db.delete(claims).where(eq(claims.runId, RUN_ID));
  await db.delete(sources).where(eq(sources.runId, RUN_ID));
  await db.delete(scoutRuns).where(eq(scoutRuns.id, RUN_ID));
  for (const c of COMPANIES) {
    await db.delete(signalEvents).where(eq(signalEvents.entityId, c.entityId));
    await db.delete(watches).where(eq(watches.id, c.watchId));
    await db.delete(entities).where(eq(entities.id, c.entityId));
  }
}

async function main() {
  await reset();

  await db.insert(scoutRuns).values({
    id: RUN_ID,
    input: THESIS,
    inputKind: "thesis",
    thesis: THESIS,
    state: "COMPLETED",
    model: "claude-sonnet-5",
    startedAt: new Date(Date.now() - 86400000),
    finishedAt: new Date(Date.now() - 86000000),
  });

  for (const c of COMPANIES) {
    await db.insert(entities).values({
      id: c.entityId,
      kind: "company",
      canonicalName: c.name,
      companyDomain: c.domain,
      companyGithubOrg: c.githubOrg,
      identityConfidence: 0.85,
      resolvedAt: new Date(),
    });

    for (const [i, cl] of c.claims.entries()) {
      await db.insert(claims).values({
        id: `${c.cmpId}_clm_${i}`,
        runId: RUN_ID,
        entityId: c.entityId,
        category: cl.category,
        text: cl.text,
        sourceIds: [],
        status: "validated",
      });
    }

    const dossierId = `${c.cmpId}_dossier`;
    await db.insert(dossiers).values({
      id: dossierId,
      runId: RUN_ID,
      entityId: c.entityId,
      whyNow: c.whyNow,
      summary: c.summary,
      opportunityScore: c.opportunity,
      confidenceScore: c.confidence,
      label: c.label,
      timeline: [],
    });

    await db.insert(discoveredCompanies).values({
      id: c.cmpId,
      runId: RUN_ID,
      rank: c.rank,
      name: c.name,
      domain: c.domain,
      githubOrg: c.githubOrg,
      oneLiner: c.oneLiner,
      whyMatch: c.whyMatch,
      selected: true,
      optSlack: true,
      optEmail: true,
      optNotion: true,
      status: "ready",
      entityId: c.entityId,
      dossierId,
      opportunityScore: c.opportunity,
      confidenceScore: c.confidence,
      label: c.label,
      whyNow: c.whyNow,
      summary: c.summary,
      docId: c.docId,
      docUrl: `https://docs.google.com/document/d/${c.docId}/edit`,
      notionPageId: c.notionPageId,
      slackThreadTs: c.slackThreadTs,
    });

    await db.insert(watches).values({
      id: c.watchId,
      entityId: c.entityId,
      runId: RUN_ID,
      active: true,
      slackMonitor: true,
      weeklyEmail: true,
      notionRecord: true,
      notionPageId: c.notionPageId,
      slackThreadTs: c.slackThreadTs,
      docUrl: `https://docs.google.com/document/d/${c.docId}/edit`,
      watchStart: new Date(Date.now() - 7 * 86400000),
      lastCheckedAt: new Date(),
    });

    await db.insert(signalEvents).values({
      id: `${c.cmpId}_sig`,
      entityId: c.entityId,
      watchId: c.watchId,
      kind: "release",
      source: "github",
      eventTime: new Date(Date.now() - 2 * 86400000),
      materiality: 68,
      assessment: `New activity detected for ${c.name}.`,
      citationUrl: `https://github.com/${c.githubOrg}`,
      dedupeKey: stableKey(c.entityId, "release", c.githubOrg, "demo"),
    });
  }

  const events: Array<[string, unknown]> = [
    ["run.created", { thesis: THESIS }],
    ["state.changed", { from: "CREATED", to: "DISCOVERING" }],
    ["companies.discovered", { count: COMPANIES.length }],
    ["state.changed", { from: "DISCOVERING", to: "AWAITING_SELECTION" }],
    ["company.selected", { count: COMPANIES.length }],
    ["state.changed", { from: "AWAITING_SELECTION", to: "RESEARCHING" }],
    ...COMPANIES.flatMap((c): Array<[string, unknown]> => [
      ["company.research.started", { companyId: c.cmpId, name: c.name }],
      ["company.research.completed", { companyId: c.cmpId, ok: true, opportunity: c.opportunity, confidence: c.confidence, label: c.label }],
      ["company.diligence.completed", { companyId: c.cmpId, name: c.name }],
    ]),
    ["run.finished", {}],
    ["state.changed", { from: "RESEARCHING", to: "COMPLETED" }],
  ];
  for (const [type, payload] of events) {
    await db.insert(runEvents).values({ runId: RUN_ID, type, payload: payload as object });
  }

  console.log(`Seeded demo thesis run ${RUN_ID} with ${COMPANIES.length} completed companies.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});
