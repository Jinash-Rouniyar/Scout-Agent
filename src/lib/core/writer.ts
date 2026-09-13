import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  scoutRuns,
  entities,
  dossiers,
  claims as claimsTable,
  watches,
  discoveredCompanies,
} from "@/lib/db/schema";
import type { Connectors } from "@/lib/connectors/types";
import { liveConnectors } from "@/lib/connectors/registry";
import { optionalEnv } from "@/env";
import { id } from "@/lib/util/ids";
import { emit } from "./events";
import { withReceipt } from "./receipts";
import type { Trace } from "@/lib/observability/langfuse";

export interface DiligencePackResult {
  notionPageId: string | null;
  docId: string | null;
  slackThreadTs: string | null;
  results: Array<{ app: string; action: string; result: string; externalId: string; reused: boolean; error?: string }>;
}

type Grouped = Record<string, string[]>;

function groupClaims(rows: { category: string; text: string }[]): Grouped {
  const grouped: Grouped = {};
  for (const c of rows) (grouped[c.category] ??= []).push(c.text);
  return grouped;
}

/** The full report memo (the canonical artifact — the Google Doc). Slack and
 *  Notion get differentiated, non-duplicative content. */
export function buildMemo(
  entity: { canonicalName: string; companyDomain?: string | null; companyGithubOrg?: string | null },
  dossier: {
    opportunityScore: number | null;
    confidenceScore: number | null;
    label: string | null;
    whyNow: string | null;
    summary: string | null;
    timeline: unknown;
  },
  grouped: Grouped,
  thesis?: string | null,
): string {
  const bullets = (items: string[]) => items.map((t) => `- ${t}`).join("\n");
  const timeline = Array.isArray(dossier.timeline)
    ? (dossier.timeline as Array<{ date: string; text: string }>)
    : [];
  const snapshot = [
    entity.companyDomain ? `Domain: ${entity.companyDomain}` : "",
    entity.companyGithubOrg ? `GitHub: github.com/${entity.companyGithubOrg}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parts = [
    `# ${entity.canonicalName}`,
    `Opportunity ${dossier.opportunityScore ?? "—"}  ·  Confidence ${dossier.confidenceScore ?? "—"}  ·  ${dossier.label ?? "Unscored"}`,
    thesis ? `Thesis — ${thesis}` : "",
    snapshot ? `## Company\n${snapshot}` : "",
    dossier.whyNow ? `## Why now\n${dossier.whyNow}` : "",
    dossier.summary ? `## Executive summary\n${dossier.summary}` : "",
    (grouped.fact ?? []).length ? `## Facts\n${bullets(grouped.fact)}` : "",
    (grouped.interpretation ?? []).length ? `## Interpretations\n${bullets(grouped.interpretation)}` : "",
    (grouped.risk ?? []).length ? `## Risks\n${bullets(grouped.risk)}` : "",
    (grouped.open_question ?? []).length ? `## Open questions\n${bullets(grouped.open_question)}` : "",
    timeline.length ? `## Timeline\n${bullets(timeline.map((t) => `${t.date} — ${t.text}`))}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export interface CompanyDeliveryOptions {
  slack: boolean;
  email: boolean;
  notion: boolean;
}

export interface CompanyDiligenceResult {
  docUrl: string | null;
  docId: string | null;
  notionPageId: string | null;
  slackThreadTs: string | null;
  results: DiligencePackResult["results"];
}

/**
 * Build a diligence pack for ONE discovered company inside a thesis run.
 *
 * - The Google Doc is ALWAYS created — it is the canonical full report.
 * - Notion / Slack / weekly-email are created only when the user selected them.
 * - Each surface gets differentiated content (Slack = short alert + link, Doc =
 *   full memo, Notion = structured record) so the pack never reads as three
 *   copies of the same paragraph.
 * - All writes go through action_receipts (idempotent, keyed per entity).
 */
export async function createCompanyDiligence(opts: {
  runId: string;
  entityId: string;
  thesis?: string | null;
  options: CompanyDeliveryOptions;
  connectors?: Connectors;
  trace?: Trace;
}): Promise<CompanyDiligenceResult> {
  const connectors = opts.connectors ?? liveConnectors();
  const { runId, entityId, options, trace } = opts;

  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);
  const [dossier] = await db
    .select()
    .from(dossiers)
    .where(and(eq(dossiers.runId, runId), eq(dossiers.entityId, entityId)))
    .limit(1);
  if (!entity || !dossier) throw new Error("missing entity or dossier for company diligence");

  const claimRows = await db
    .select()
    .from(claimsTable)
    .where(and(eq(claimsTable.runId, runId), eq(claimsTable.entityId, entityId)));
  const grouped = groupClaims(claimRows);

  const results: DiligencePackResult["results"] = [];
  const push = (app: string, action: string, r: { result: string; externalObjectId: string; reused: boolean; error?: string }) => {
    results.push({ app, action, result: r.result, externalId: r.externalObjectId, reused: r.reused, error: r.error });
    void emit(runId, "action.receipt", { app, action, entityId, ...r });
  };

  // 1) Google Doc — full report (always).
  const docSpan = trace?.tool("write-google-doc", { entityId });
  const memo = buildMemo(entity, dossier, grouped, opts.thesis);
  const doc = await withReceipt(
    { actionType: "google_doc", targetApp: "google_docs", entityId, scopeKey: "memo-v2" },
    async () => {
      const d = await connectors.google.createDoc(`${entity.canonicalName} — Diligence memo`, memo);
      return { externalObjectId: d.docId };
    },
  );
  if (doc.reused && doc.externalObjectId && connectors.google.replaceDoc) {
    await connectors.google.replaceDoc(doc.externalObjectId, memo);
  }
  docSpan?.end(doc);
  const docUrl = doc.externalObjectId ? `https://docs.google.com/document/d/${doc.externalObjectId}/edit` : null;
  push("google_docs", "google_doc", doc);

  // 2) Notion structured record (opt-in).
  let notionPageId: string | null = null;
  if (options.notion) {
    const nSpan = trace?.tool("write-notion", { entityId });
    const notion = await withReceipt(
      { actionType: "notion_page", targetApp: "notion", entityId },
      async () => {
        const page = await connectors.notion.createDiligenceRecord({
          title: entity.canonicalName,
          domain: entity.companyDomain ?? undefined,
          githubUrl: entity.companyGithubOrg ? `https://github.com/${entity.companyGithubOrg}` : undefined,
          thesis: opts.thesis ?? undefined,
          opportunityScore: dossier.opportunityScore ?? 0,
          confidenceScore: dossier.confidenceScore ?? 0,
          label: dossier.label ?? "",
          whyNow: dossier.whyNow ?? "",
          summary: dossier.summary ?? "",
          docUrl: docUrl ?? undefined,
          claims: {
            fact: grouped.fact ?? [],
            interpretation: grouped.interpretation ?? [],
            risk: grouped.risk ?? [],
            open_question: grouped.open_question ?? [],
          },
        });
        return { externalObjectId: page.pageId };
      },
    );
    nSpan?.end(notion);
    notionPageId = notion.externalObjectId || null;
    push("notion", "notion_page", notion);
  }

  // 3) Slack dealflow alert (opt-in) — short, links to the full report.
  let slackThreadTs: string | null = null;
  if (options.slack) {
    const channel = optionalEnv("SLACK_CHANNEL_ID") ?? "";
    const sSpan = trace?.tool("write-slack", { entityId });
    const slack = await withReceipt(
      { actionType: "slack_thread", targetApp: "slack", entityId },
      async () => {
        if (!channel) throw new Error("SLACK_CHANNEL_ID not configured");
        const line1 = `*${entity.canonicalName}* — ${dossier.label} · Opportunity ${dossier.opportunityScore}/100 · Confidence ${dossier.confidenceScore}/100`;
        const line2 = firstSentence(dossier.whyNow ?? dossier.summary ?? "");
        const line3 = docUrl ? `Full report: ${docUrl}` : "";
        const text = [line1, line2, line3].filter(Boolean).join("\n");
        const t = await connectors.slack.createThread(channel, text);
        return { externalObjectId: t.ts };
      },
    );
    sSpan?.end(slack);
    slackThreadTs = slack.externalObjectId || null;
    push("slack", "slack_thread", slack);
  }

  // 4) Watch (monitoring) — created when Slack monitoring or newsletter is on.
  //    Notion-only stays a static record (no cron monitoring) but we still store
  //    the page id if a watch exists so timeline appends can land.
  if (options.slack || options.email || options.notion) {
    const existing = await db.select().from(watches).where(eq(watches.entityId, entityId)).limit(1);
    const patch = {
      active: true,
      runId,
      slackMonitor: options.slack,
      weeklyEmail: options.email,
      notionRecord: options.notion,
      notionPageId: notionPageId ?? existing[0]?.notionPageId ?? null,
      slackThreadTs: slackThreadTs ?? existing[0]?.slackThreadTs ?? null,
      docUrl: docUrl ?? existing[0]?.docUrl ?? null,
    };
    if (existing[0]) {
      await db.update(watches).set(patch).where(eq(watches.id, existing[0].id));
    } else {
      await db.insert(watches).values({ id: id("watch"), entityId, ...patch });
    }
  }

  // 5) Persist the diligence result onto the discovered-company row.
  await db
    .update(discoveredCompanies)
    .set({
      status: "ready",
      docUrl,
      docId: doc.externalObjectId || null,
      notionPageId,
      slackThreadTs,
      updatedAt: new Date(),
    })
    .where(and(eq(discoveredCompanies.runId, runId), eq(discoveredCompanies.entityId, entityId)));

  return { docUrl, docId: doc.externalObjectId || null, notionPageId, slackThreadTs, results };
}

function firstSentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const m = t.match(/^(.{0,220}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 220)).trim();
}

/**
 * LEGACY single-entity diligence pack (used by the eval harness idempotency
 * scenario and the /approve route). The thesis-first flow uses
 * createCompanyDiligence instead.
 */
export async function createDiligencePack(
  runId: string,
  connectors: Connectors = liveConnectors(),
  trace?: Trace,
): Promise<DiligencePackResult> {
  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (!run?.entityId) throw new Error("run has no confirmed entity");
  const [entity] = await db.select().from(entities).where(eq(entities.id, run.entityId)).limit(1);
  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.runId, runId)).limit(1);
  if (!entity || !dossier) throw new Error("missing entity or dossier");

  const allClaims = await db.select().from(claimsTable).where(eq(claimsTable.runId, runId));
  const grouped = groupClaims(allClaims);

  const results: DiligencePackResult["results"] = [];
  const scopeBase = { entityId: entity.id };

  const span = trace?.tool("write-notion", { entity: entity.id });
  const notion = await withReceipt(
    { ...scopeBase, actionType: "notion_page", targetApp: "notion" },
    async () => {
      const page = await connectors.notion.createFounderPage({
        title: entity.canonicalName,
        summary: dossier.summary ?? "",
        opportunityScore: dossier.opportunityScore ?? 0,
        confidenceScore: dossier.confidenceScore ?? 0,
        label: dossier.label ?? "",
      });
      return { externalObjectId: page.pageId };
    },
  );
  span?.end(notion);
  results.push({ app: "notion", action: "notion_page", result: notion.result, externalId: notion.externalObjectId, reused: notion.reused, error: notion.error });
  await emit(runId, "action.receipt", { app: "notion", action: "notion_page", ...notion });

  const gspan = trace?.tool("write-google-doc", { entity: entity.id });
  const memo = buildMemo(entity, dossier, grouped, run.thesis);
  const doc = await withReceipt(
    { ...scopeBase, actionType: "google_doc", targetApp: "google_docs", scopeKey: "memo-v2" },
    async () => {
      const d = await connectors.google.createDoc(`${entity.canonicalName} — Diligence memo`, memo);
      return { externalObjectId: d.docId };
    },
  );
  if (doc.reused && doc.externalObjectId && connectors.google.replaceDoc) {
    await connectors.google.replaceDoc(doc.externalObjectId, memo);
  }
  gspan?.end(doc);
  results.push({ app: "google_docs", action: "google_doc", result: doc.result, externalId: doc.externalObjectId, reused: doc.reused, error: doc.error });
  await emit(runId, "action.receipt", { app: "google_docs", action: "google_doc", ...doc });

  const channel = optionalEnv("SLACK_CHANNEL_ID") ?? "";
  const sspan = trace?.tool("write-slack", { entity: entity.id });
  const slack = await withReceipt(
    { ...scopeBase, actionType: "slack_thread", targetApp: "slack" },
    async () => {
      if (!channel) throw new Error("SLACK_CHANNEL_ID not configured");
      const docUrl = doc.externalObjectId
        ? `https://docs.google.com/document/d/${doc.externalObjectId}/edit`
        : "";
      const text = [
        `*${entity.canonicalName}* — ${dossier.label} · Opportunity ${dossier.opportunityScore}/100 · Confidence ${dossier.confidenceScore}/100`,
        firstSentence(dossier.whyNow ?? dossier.summary ?? ""),
        docUrl ? `Full report: ${docUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const t = await connectors.slack.createThread(channel, text);
      return { externalObjectId: t.ts };
    },
  );
  sspan?.end(slack);
  results.push({ app: "slack", action: "slack_thread", result: slack.result, externalId: slack.externalObjectId, reused: slack.reused, error: slack.error });
  await emit(runId, "action.receipt", { app: "slack", action: "slack_thread", ...slack });

  const existing = await db.select().from(watches).where(eq(watches.entityId, entity.id)).limit(1);
  if (existing[0]) {
    await db
      .update(watches)
      .set({ active: true, notionPageId: notion.externalObjectId || existing[0].notionPageId, slackThreadTs: slack.externalObjectId || existing[0].slackThreadTs })
      .where(eq(watches.id, existing[0].id));
  } else {
    await db.insert(watches).values({
      id: id("watch"),
      entityId: entity.id,
      runId,
      active: true,
      notionPageId: notion.externalObjectId || null,
      slackThreadTs: slack.externalObjectId || null,
    });
  }

  return {
    notionPageId: notion.externalObjectId || null,
    docId: doc.externalObjectId || null,
    slackThreadTs: slack.externalObjectId || null,
    results,
  };
}
