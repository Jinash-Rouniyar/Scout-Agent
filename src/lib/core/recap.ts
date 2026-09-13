import { and, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { signalEvents, entities } from "@/lib/db/schema";
import type { Connectors } from "@/lib/connectors/types";
import { liveConnectors } from "@/lib/connectors/registry";
import { optionalEnv } from "@/env";
import { windowKey } from "./cron";
import { withReceipt } from "./receipts";
import type { Trace } from "@/lib/observability/langfuse";

export interface RecapOptions {
  force?: boolean;
  asOfDate?: Date;
  connectors?: Connectors;
  trace?: Trace;
}

export interface RecapResult {
  period: string;
  materialCount: number;
  trendCount: number;
  gmail: { result: string; externalId: string; reused: boolean; error?: string };
  slack: { result: string; externalId: string; reused: boolean; error?: string };
  body: string;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build and SEND the weekly recap. Same function for the Friday cron and the
 * demo-only manual trigger, so a rehearsal and the real cron never double-send
 * (idempotency via action_receipts keyed by the recap period).
 *
 * The Gmail send is REQUIRED — it actually sends, not a draft.
 */
export async function runWeeklyRecap(opts: RecapOptions = {}): Promise<RecapResult> {
  const connectors = opts.connectors ?? liveConnectors();
  const asOf = opts.asOfDate ?? new Date();
  const period = windowKey("recap", asOf);
  const since = new Date(asOf.getTime() - SEVEN_DAYS);

  // Material signals in the window.
  const events = await db
    .select()
    .from(signalEvents)
    .where(gte(signalEvents.eventTime, since));

  const material = events.filter((e) => e.materiality >= 60 && e.eventTime <= asOf);
  const minor = events.filter((e) => e.materiality < 60 && e.eventTime <= asOf);

  const entityIds = [...new Set(events.map((e) => e.entityId))];
  const ents = entityIds.length ? await db.select().from(entities).where(inArray(entities.id, entityIds)) : [];
  const nameById = new Map(ents.map((e) => [e.id, e.canonicalName]));

  // Corroborated minor-event trends: >=3 minor events for one entity.
  const minorByEntity = new Map<string, number>();
  for (const e of minor) minorByEntity.set(e.entityId, (minorByEntity.get(e.entityId) ?? 0) + 1);
  const trends = [...minorByEntity.entries()].filter(([, n]) => n >= 3);

  const body = buildRecapBody(period, material, trends, nameById);

  // Gmail send (idempotent per period). REQUIRED to actually send.
  const to = optionalEnv("RECAP_TO_EMAIL") ?? "";
  const gspan = opts.trace?.span("action:gmail_recap", { period, materialCount: material.length });
  const gmail = await withReceipt(
    { actionType: "gmail_recap", targetApp: "gmail", scopeKey: period },
    async () => {
      if (!to) throw new Error("RECAP_TO_EMAIL not configured");
      const res = await connectors.google.sendGmail({
        to,
        subject: `Scout weekly recap — ${period} (${material.length} material signals)`,
        body,
      });
      return { externalObjectId: res.messageId };
    },
  );
  gspan?.end(gmail);

  // Compact Slack digest (idempotent per period).
  const channel = optionalEnv("SLACK_CHANNEL_ID") ?? "";
  const sspan = opts.trace?.span("action:slack_digest", { period });
  const slack = await withReceipt(
    { actionType: "slack_post", targetApp: "slack", scopeKey: `recap-digest:${period}` },
    async () => {
      if (!channel) throw new Error("SLACK_CHANNEL_ID not configured");
      const digest = `*Scout weekly recap — ${period}*\n${material.length} material signals, ${trends.length} corroborated trends.`;
      const r = await connectors.slack.createThread(channel, digest);
      return { externalObjectId: r.ts };
    },
  );
  sspan?.end(slack);

  return {
    period,
    materialCount: material.length,
    trendCount: trends.length,
    gmail: { result: gmail.result, externalId: gmail.externalObjectId, reused: gmail.reused, error: gmail.error },
    slack: { result: slack.result, externalId: slack.externalObjectId, reused: slack.reused, error: slack.error },
    body,
  };
}

function buildRecapBody(
  period: string,
  material: Array<typeof signalEvents.$inferSelect>,
  trends: Array<[string, number]>,
  nameById: Map<string, string>,
): string {
  const lines: string[] = [`Scout weekly recap — ${period}`, ""];
  if (material.length === 0) {
    lines.push("No material signals this week.");
  } else {
    lines.push(`Material signals (${material.length}):`);
    const byEntity = new Map<string, typeof material>();
    for (const e of material) {
      const arr = byEntity.get(e.entityId) ?? [];
      arr.push(e);
      byEntity.set(e.entityId, arr);
    }
    for (const [entityId, evs] of byEntity) {
      lines.push(`\n${nameById.get(entityId) ?? entityId}`);
      for (const ev of evs) {
        lines.push(`  - [${ev.materiality}] ${ev.kind}: ${ev.assessment}${ev.citationUrl ? ` (${ev.citationUrl})` : ""}`);
      }
    }
  }
  if (trends.length) {
    lines.push("", "Corroborated minor trends (not milestones):");
    for (const [entityId, n] of trends) {
      lines.push(`  - ${nameById.get(entityId) ?? entityId}: ${n} minor events this week`);
    }
  }
  return lines.join("\n");
}
