import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { signalEvents, entities, watches, dossiers } from "@/lib/db/schema";
import type { Connectors } from "@/lib/connectors/types";
import { liveConnectors } from "@/lib/connectors/registry";
import { optionalEnv } from "@/env";
import { windowKey } from "./cron";
import { withReceipt } from "./receipts";
import type { Trace } from "@/lib/observability/langfuse";
import { anthropic, SCOUT_MODEL } from "@/lib/util/anthropic";
import {
  buildRecapHtml,
  buildRecapPlaintext,
  fallbackEditorial,
  formatRecapDate,
  type RecapCompany,
  type RecapEmailModel,
  type RecapSignal,
} from "./recapEmail";
import { fetchCompanyLogos, loadNewsletterHero, logoCidFor } from "./companyLogos";

export interface RecapOptions {
  force?: boolean;
  asOfDate?: Date;
  connectors?: Connectors;
  trace?: Trace;
  /** Demo override — send the recap to this address instead of RECAP_TO_EMAIL. */
  to?: string;
}

export interface RecapResult {
  period: string;
  materialCount: number;
  trendCount: number;
  logoCount: number;
  gmail: { result: string; externalId: string; reused: boolean; error?: string };
  slack: { result: string; externalId: string; reused: boolean; error?: string };
  body: string;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build and SEND the weekly recap. Same function for the Friday cron and the
 * demo-only manual trigger.
 *
 * Cron stays idempotent per week. A demo override address always sends a fresh
 * HTML email so you can rehearse the landing without waiting for Friday.
 */
export async function runWeeklyRecap(opts: RecapOptions = {}): Promise<RecapResult> {
  const connectors = opts.connectors ?? liveConnectors();
  const asOf = opts.asOfDate ?? new Date();
  const period = windowKey("recap", asOf);
  const since = new Date(asOf.getTime() - SEVEN_DAYS);

  const emailWatches = await db
    .select()
    .from(watches)
    .where(and(eq(watches.active, true), eq(watches.weeklyEmail, true)));
  const watchedIds = new Set(emailWatches.map((w) => w.entityId));
  const watchByEntity = new Map(emailWatches.map((w) => [w.entityId, w]));

  let events = await db.select().from(signalEvents).where(gte(signalEvents.eventTime, since));
  if (watchedIds.size > 0) events = events.filter((e) => watchedIds.has(e.entityId));

  const materialEvents = events.filter((e) => e.materiality >= 60 && e.eventTime <= asOf);
  const minor = events.filter((e) => e.materiality < 60 && e.eventTime <= asOf);

  const entityIds = [...new Set([...events.map((e) => e.entityId), ...watchedIds])];
  const ents = entityIds.length ? await db.select().from(entities).where(inArray(entities.id, entityIds)) : [];
  const entityById = new Map(ents.map((e) => [e.id, e]));

  const watchedIdList = [...watchedIds];
  const doss = watchedIdList.length ? await db.select().from(dossiers).where(inArray(dossiers.entityId, watchedIdList)) : [];
  const watching: RecapCompany[] = watchedIdList.map((eid) => {
    const d = doss.find((x) => x.entityId === eid);
    const e = entityById.get(eid);
    const w = watchByEntity.get(eid);
    return {
      name: e?.canonicalName ?? eid,
      opportunity: d?.opportunityScore ?? null,
      confidence: d?.confidenceScore ?? null,
      label: d?.label ?? null,
      whyNow: d?.whyNow ?? null,
      summary: d?.summary ?? null,
      domain: e?.companyDomain ?? null,
      githubOrg: e?.companyGithubOrg ?? null,
      docUrl: w?.docUrl ?? null,
    };
  });

  const [logos, hero] = await Promise.all([fetchCompanyLogos(watching), loadNewsletterHero()]);
  const images = hero ? [hero, ...logos] : logos;
  const logoCids = new Set(logos.map((image) => image.cid));
  for (const company of watching) {
    const cid = logoCidFor(company.name);
    if (logoCids.has(cid)) company.logoCid = cid;
  }

  const material: RecapSignal[] = materialEvents.map((e) => {
    const name = entityById.get(e.entityId)?.canonicalName ?? e.entityId;
    const cid = logoCidFor(name);
    return {
      name,
      kind: e.kind,
      materiality: e.materiality,
      assessment: e.assessment ?? "New activity detected.",
      citationUrl: e.citationUrl,
      logoCid: logoCids.has(cid) ? cid : null,
    };
  });

  const materialNames = new Set(material.map((s) => s.name));
  const quiet = watching.filter((c) => !materialNames.has(c.name));

  const minorByEntity = new Map<string, number>();
  for (const e of minor) minorByEntity.set(e.entityId, (minorByEntity.get(e.entityId) ?? 0) + 1);
  const trends = [...minorByEntity.entries()]
    .filter(([, n]) => n >= 3)
    .map(([entityId, count]) => ({ name: entityById.get(entityId)?.canonicalName ?? entityId, count }));

  const draft: Omit<RecapEmailModel, "editorial"> = {
    asOf,
    period,
    watching,
    material,
    quiet,
    trends,
    heroCid: hero?.cid ?? null,
  };
  const editorial = await writeWeeklyBrief(draft, opts.trace);
  const model: RecapEmailModel = { ...draft, editorial };
  const body = buildRecapPlaintext(model);
  const html = buildRecapHtml(model);
  const subject = `This Week at Scout · ${formatRecapDate(asOf)}`;

  const overrideTo = opts.to?.trim();
  const to = overrideTo || optionalEnv("RECAP_TO_EMAIL") || "";
  const gspan = opts.trace?.tool("write-gmail", { period, materialCount: material.length, to });

  let gmail: RecapResult["gmail"];
  if (overrideTo) {
    try {
      if (!to) throw new Error("Enter an email address or set RECAP_TO_EMAIL");
      const res = await connectors.google.sendGmail({ to, subject, body, html, images });
      gmail = { result: "success", externalId: res.messageId, reused: false };
    } catch (e) {
      gmail = {
        result: "failed",
        externalId: "",
        reused: false,
        error: e instanceof Error ? e.message : "gmail-failed",
      };
    }
  } else {
    const posted = await withReceipt(
      { actionType: "gmail_recap", targetApp: "gmail", scopeKey: `recap-html-v1:${period}` },
      async () => {
        if (!to) throw new Error("Enter an email address or set RECAP_TO_EMAIL");
        const res = await connectors.google.sendGmail({ to, subject, body, html, images });
        return { externalObjectId: res.messageId };
      },
    );
    gmail = { result: posted.result, externalId: posted.externalObjectId, reused: posted.reused, error: posted.error };
  }
  gspan?.end(gmail);

  let slack = { result: "skipped", externalId: "", reused: false, error: undefined as string | undefined };
  if (!overrideTo) {
    const channel = optionalEnv("SLACK_CHANNEL_ID") ?? "";
    const sspan = opts.trace?.tool("write-slack-digest", { period });
    const posted = await withReceipt(
      { actionType: "slack_post", targetApp: "slack", scopeKey: `recap-digest:${period}` },
      async () => {
        if (!channel) throw new Error("SLACK_CHANNEL_ID not configured");
        const digest = `*This Week at Scout — ${formatRecapDate(asOf)}*\n${material.length} material signals across ${watching.length} watched companies.`;
        const r = await connectors.slack.createThread(channel, digest);
        return { externalObjectId: r.ts };
      },
    );
    sspan?.end(posted);
    slack = { result: posted.result, externalId: posted.externalObjectId, reused: posted.reused, error: posted.error };
  }

  return {
    period,
    materialCount: material.length,
    trendCount: trends.length,
    logoCount: images.length,
    gmail,
    slack,
    body,
  };
}

async function writeWeeklyBrief(
  model: Omit<RecapEmailModel, "editorial">,
  trace?: Trace,
): Promise<string> {
  const span = trace?.generation("recap-editorial", {
    watching: model.watching.map((c) => c.name),
    material: model.material.length,
  });
  try {
    const client = anthropic();
    const response = await client.messages.create({
      model: SCOUT_MODEL,
      max_tokens: 420,
      system:
        "You write Scout's weekly investor brief. Tone: calm, specific, editorial — close to a YC weekly note, not a sales email. 2 short paragraphs. No emojis. No hype. Do not invent companies, numbers, or events. Only use the JSON. If nothing material moved, say monitoring continued and what is still being watched.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            date: formatRecapDate(model.asOf),
            watching: model.watching.map((c) => ({
              name: c.name,
              label: c.label,
              opportunity: c.opportunity,
              confidence: c.confidence,
            })),
            material: model.material.map((s) => ({
              name: s.name,
              kind: s.kind,
              assessment: s.assessment,
            })),
            quiet: model.quiet.map((c) => c.name),
          }),
        },
      ],
    });
    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const editorial = text || fallbackEditorial(model);
    span?.end({ editorial });
    return editorial;
  } catch (e) {
    const editorial = fallbackEditorial(model);
    span?.end({ fallback: true, error: e instanceof Error ? e.message : "editorial-failed" });
    return editorial;
  }
}
