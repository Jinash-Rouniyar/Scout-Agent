import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scoutRuns, entities, dossiers, claims as claimsTable, watches } from "@/lib/db/schema";
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

function buildMemo(entity: { canonicalName: string }, dossier: any, grouped: Record<string, string[]>): string {
  const section = (title: string, items: string[]) =>
    items.length ? `\n${title}\n${items.map((t) => `- ${t}`).join("\n")}\n` : "";
  return [
    `Scout diligence memo — ${entity.canonicalName}`,
    `Opportunity ${dossier.opportunityScore} / Confidence ${dossier.confidenceScore} — ${dossier.label}`,
    "",
    `Why now:\n${dossier.whyNow ?? ""}`,
    "",
    `Summary:\n${dossier.summary ?? ""}`,
    section("Facts", grouped.fact ?? []),
    section("Interpretations", grouped.interpretation ?? []),
    section("Risks", grouped.risk ?? []),
    section("Open questions", grouped.open_question ?? []),
  ].join("\n");
}

/**
 * Build the approved diligence pack across Notion, Google Docs, and Slack.
 * Every write goes through the action_receipts idempotency authority, so
 * re-approval or retries never create duplicates.
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
  const grouped: Record<string, string[]> = {};
  for (const c of allClaims) (grouped[c.category] ??= []).push(c.text);

  const results: DiligencePackResult["results"] = [];
  const scopeBase = { entityId: entity.id };

  // 1) Notion founder page
  const span = trace?.span("action:notion", { entity: entity.id });
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

  // 2) Google Doc memo
  const gspan = trace?.span("action:google_doc", { entity: entity.id });
  const memo = buildMemo(entity, dossier, grouped);
  const doc = await withReceipt(
    { ...scopeBase, actionType: "google_doc", targetApp: "google_docs" },
    async () => {
      const d = await connectors.google.createDoc(`Scout memo — ${entity.canonicalName}`, memo);
      return { externalObjectId: d.docId };
    },
  );
  gspan?.end(doc);
  results.push({ app: "google_docs", action: "google_doc", result: doc.result, externalId: doc.externalObjectId, reused: doc.reused, error: doc.error });
  await emit(runId, "action.receipt", { app: "google_docs", action: "google_doc", ...doc });

  // 3) Slack dealflow thread
  const channel = optionalEnv("SLACK_CHANNEL_ID") ?? "";
  const sspan = trace?.span("action:slack", { entity: entity.id });
  const slack = await withReceipt(
    { ...scopeBase, actionType: "slack_thread", targetApp: "slack" },
    async () => {
      if (!channel) throw new Error("SLACK_CHANNEL_ID not configured");
      const text = `*${entity.canonicalName}* — ${dossier.label} (Opportunity ${dossier.opportunityScore}, Confidence ${dossier.confidenceScore})\n${dossier.whyNow ?? ""}`;
      const t = await connectors.slack.createThread(channel, text);
      return { externalObjectId: t.ts };
    },
  );
  sspan?.end(slack);
  results.push({ app: "slack", action: "slack_thread", result: slack.result, externalId: slack.externalObjectId, reused: slack.reused, error: slack.error });
  await emit(runId, "action.receipt", { app: "slack", action: "slack_thread", ...slack });

  // Create/activate the watch, storing thread + page for future monitoring writes.
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
