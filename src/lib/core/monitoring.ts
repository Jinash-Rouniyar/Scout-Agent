import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { snapshots, signalEvents, entities, watches } from "@/lib/db/schema";
import type { Connectors, GithubRepo } from "@/lib/connectors/types";
import { id, stableKey, contentHash } from "@/lib/util/ids";
import type { SignalKind } from "@/lib/schemas";
import { detectLaunchTerms, scoreSignal } from "./materiality";
import { withReceipt } from "./receipts";
import { optionalEnv } from "@/env";

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const GROWTH_MIN_RATIO = 1.25;
const GROWTH_MIN_ABS = 10;
const CONTRIB_MIN_EXTERNAL = 2;

type EntityRow = typeof entities.$inferSelect;
type WatchRow = typeof watches.$inferSelect;

interface RepoSnap {
  fullName: string;
  stars: number;
  forks: number;
  createdAt: string;
  isFork: boolean;
  latestReleaseTag: string | null;
  latestReleasePublishedAt: string | null;
  contributors: string[];
}

interface GithubSnapData {
  repos: RepoSnap[];
  totalStars: number;
}

export interface DetectedSignal {
  kind: SignalKind;
  materiality: number;
  dedupeKey: string;
  assessment: string;
  citationUrl?: string;
  eventTime: string;
  payload: Record<string, unknown>;
}

export interface MonitorResult {
  entityId: string;
  detected: DetectedSignal[];
  wrote: number;
  degraded: string[];
}

/** GitHub identities to watch for a person or company. */
function githubIdentities(entity: EntityRow): { logins: string[]; org: string | null } {
  if (entity.kind === "company") {
    return { logins: entity.companyGithubOrg ? [entity.companyGithubOrg] : [], org: entity.companyGithubOrg ?? null };
  }
  const logins = new Set<string>();
  if (entity.githubLogin) logins.add(entity.githubLogin);
  for (const l of entity.linkedGithubAccounts ?? []) logins.add(l);
  return { logins: [...logins], org: null };
}

async function captureGithub(entity: EntityRow, connectors: Connectors): Promise<GithubSnapData> {
  const { logins } = githubIdentities(entity);
  const repos: RepoSnap[] = [];
  for (const login of logins) {
    const list = await connectors.github.listRepos(login, { limit: 20 }).catch(() => [] as GithubRepo[]);
    for (const r of list) {
      const [owner, name] = r.fullName.split("/");
      const releases = await connectors.github.listReleases(owner, name).catch(() => []);
      const contributors = await connectors.github.listContributors(owner, name, { limit: 30 }).catch(() => []);
      const latest = releases[0];
      repos.push({
        fullName: r.fullName,
        stars: r.stars,
        forks: r.forks,
        createdAt: r.createdAt,
        isFork: r.isFork,
        latestReleaseTag: latest?.tagName ?? null,
        latestReleasePublishedAt: latest?.publishedAt ?? null,
        contributors: contributors.map((c) => c.login),
      });
    }
  }
  return { repos, totalStars: repos.reduce((s, r) => s + r.stars, 0) };
}

async function latestSnapshotAtOrBefore(entityId: string, source: string, at: Date) {
  const [row] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.entityId, entityId), eq(snapshots.source, source), lte(snapshots.capturedAt, at)))
    .orderBy(desc(snapshots.capturedAt))
    .limit(1);
  return row ?? null;
}

function isExternalContributor(login: string, entity: EntityRow, orgMembers: Set<string>): boolean {
  if (entity.githubLogin && login === entity.githubLogin) return false;
  if ((entity.linkedGithubAccounts ?? []).includes(login)) return false;
  if (orgMembers.has(login)) return false;
  return true;
}

/** Detect GitHub events by comparing the current snapshot to the 7-day baseline. */
async function detectGithub(
  entity: EntityRow,
  watch: WatchRow,
  current: GithubSnapData,
  connectors: Connectors,
): Promise<DetectedSignal[]> {
  const now = new Date();
  const baselineRow = await latestSnapshotAtOrBefore(entity.id, "github", new Date(now.getTime() - SEVEN_DAYS));
  const baseline = (baselineRow?.data as GithubSnapData | undefined) ?? null;
  const baseByName = new Map((baseline?.repos ?? []).map((r) => [r.fullName, r]));
  const { org } = githubIdentities(entity);
  const orgMembers = new Set(org ? await connectors.github.listOrgMembers(org).catch(() => []) : []);
  const signals: DetectedSignal[] = [];

  for (const repo of current.repos) {
    const base = baseByName.get(repo.fullName);
    const url = `https://github.com/${repo.fullName}`;

    // New repo: public, non-fork, created after watch start, owned by confirmed identity.
    const createdMs = new Date(repo.createdAt).getTime();
    if (!base && !repo.isFork && createdMs >= watch.watchStart.getTime()) {
      signals.push({
        kind: "new_repo",
        materiality: scoreSignal("new_repo"),
        dedupeKey: stableKey(entity.id, "new_repo", repo.fullName),
        assessment: `New public repository ${repo.fullName} created after watch start.`,
        citationUrl: url,
        eventTime: repo.createdAt,
        payload: { repo: repo.fullName, stars: repo.stars },
      });
    }

    // New tagged release since baseline (or within last 7 days if no baseline).
    if (repo.latestReleaseTag && repo.latestReleasePublishedAt) {
      const publishedMs = new Date(repo.latestReleasePublishedAt).getTime();
      const baseTag = base?.latestReleaseTag ?? null;
      const isNew = base ? repo.latestReleaseTag !== baseTag : now.getTime() - publishedMs <= SEVEN_DAYS;
      if (isNew) {
        signals.push({
          kind: "release",
          materiality: scoreSignal("release"),
          dedupeKey: stableKey(entity.id, "release", repo.fullName, repo.latestReleaseTag),
          assessment: `New tagged release ${repo.latestReleaseTag} on ${repo.fullName}.`,
          citationUrl: `${url}/releases/tag/${repo.latestReleaseTag}`,
          eventTime: repo.latestReleasePublishedAt,
          payload: { repo: repo.fullName, tag: repo.latestReleaseTag },
        });
      }
    }

    // Star growth: >=25% AND >=10 absolute over the 7-day baseline.
    if (base) {
      const delta = repo.stars - base.stars;
      if (base.stars > 0 && repo.stars >= base.stars * GROWTH_MIN_RATIO && delta >= GROWTH_MIN_ABS) {
        signals.push({
          kind: "star_growth",
          materiality: scoreSignal("star_growth"),
          dedupeKey: stableKey(entity.id, "star_growth", repo.fullName, now.toISOString().slice(0, 10)),
          assessment: `${repo.fullName} stars grew ${base.stars} → ${repo.stars} (+${delta}) in 7 days.`,
          citationUrl: url,
          eventTime: now.toISOString(),
          payload: { repo: repo.fullName, from: base.stars, to: repo.stars },
        });
      }

      // External first-time contributors: >=2 new external contributors vs baseline.
      const baseContribs = new Set(base.contributors);
      const firstTimeExternal = repo.contributors.filter(
        (c) => !baseContribs.has(c) && isExternalContributor(c, entity, orgMembers),
      );
      if (firstTimeExternal.length >= CONTRIB_MIN_EXTERNAL) {
        signals.push({
          kind: "contributors",
          materiality: scoreSignal("contributors"),
          dedupeKey: stableKey(entity.id, "contributors", repo.fullName, now.toISOString().slice(0, 10)),
          assessment: `${firstTimeExternal.length} new external contributors on ${repo.fullName}: ${firstTimeExternal.slice(0, 5).join(", ")}.`,
          citationUrl: `${url}/graphs/contributors`,
          eventTime: now.toISOString(),
          payload: { repo: repo.fullName, contributors: firstTimeExternal.slice(0, 10) },
        });
      }
    }
  }

  return signals;
}

/** Company site/RSS change detection + deterministic launch-term classification. */
async function detectSite(entity: EntityRow, connectors: Connectors, degraded: string[]): Promise<DetectedSignal[]> {
  if (!entity.companyDomain) return [];
  const url = `https://${entity.companyDomain}`;
  const page = await connectors.fetch.fetchPage(url).catch(() => null);
  if (!page || page.blocked) {
    degraded.push(`site:${page?.blocked ?? "fetch-failed"}`);
    return [];
  }

  const now = new Date();
  const prior = await latestSnapshotAtOrBefore(entity.id, "rss", now);
  const changed = !prior || prior.contentHash !== page.contentHash;
  const terms = detectLaunchTerms(`${page.title ?? ""} ${page.text}`);

  if (changed && terms.length > 0) {
    return [
      {
        kind: "rss_launch",
        materiality: scoreSignal("rss_launch"),
        dedupeKey: stableKey(entity.id, "rss_launch", page.contentHash),
        assessment: `Company site change matched launch terms: ${terms.join(", ")}.`,
        citationUrl: page.finalUrl,
        eventTime: now.toISOString(),
        payload: { terms, title: page.title },
      },
    ];
  }
  return [];
}

/** Tavily-backed web monitoring. Dedupes by URL/content hash; degrades silently. */
async function detectWeb(entity: EntityRow, connectors: Connectors, degraded: string[]): Promise<DetectedSignal[]> {
  const query = `${entity.canonicalName} ${entity.companyDomain ?? ""} funding OR launch OR release OR raised`.trim();
  const res = await connectors.search.search(query, { limit: 8 });
  if (res.degraded) {
    degraded.push("web:provider-unavailable");
    return []; // never invent signals
  }
  const now = new Date();
  const signals: DetectedSignal[] = [];
  for (const r of res.results) {
    const terms = detectLaunchTerms(`${r.title} ${r.snippet}`);
    if (terms.length === 0) continue;
    const fundingLike = terms.some((t) => ["raised", "funding", "seed"].includes(t));
    signals.push({
      kind: fundingLike ? "funding" : "web_launch",
      materiality: scoreSignal(fundingLike ? "funding" : "web_launch"),
      dedupeKey: stableKey(entity.id, "web", contentHash(r.url), r.publishedDate ?? ""),
      assessment: `Independent web signal (${terms.join(", ")}): ${r.title}`,
      citationUrl: r.url,
      eventTime: r.publishedDate ?? now.toISOString(),
      payload: { title: r.title, terms },
    });
  }
  return signals;
}

/**
 * Monitor one watched entity: capture a durable daily snapshot, detect events,
 * deduplicate, and for material events (>=60) write idempotently to the Notion
 * timeline + founder Slack thread. Non-material events are stored silently.
 */
export async function monitorEntity(watch: WatchRow, connectors: Connectors): Promise<MonitorResult> {
  const [entity] = await db.select().from(entities).where(eq(entities.id, watch.entityId)).limit(1);
  if (!entity) return { entityId: watch.entityId, detected: [], wrote: 0, degraded: ["entity-missing"] };

  const degraded: string[] = [];
  const now = new Date();

  // 1) Capture + persist snapshots (unique per entity/source/capturedAt).
  const github = await captureGithub(entity, connectors).catch((e) => {
    degraded.push(`github:${e instanceof Error ? e.message : "error"}`);
    return null;
  });
  if (github) {
    await db
      .insert(snapshots)
      .values({ id: id("snap"), entityId: entity.id, source: "github", capturedAt: now, data: github, contentHash: contentHash(JSON.stringify(github)) })
      .onConflictDoNothing({ target: [snapshots.entityId, snapshots.source, snapshots.capturedAt] });
  }

  // 2) Detect events across sources.
  const detected: DetectedSignal[] = [];
  if (github) detected.push(...(await detectGithub(entity, watch, github, connectors)));
  const site = await detectSite(entity, connectors, degraded);
  detected.push(...site);
  detected.push(...(await detectWeb(entity, connectors, degraded)));

  // Persist the site snapshot after detection so next run compares correctly.
  if (entity.companyDomain) {
    const page = await connectors.fetch.fetchPage(`https://${entity.companyDomain}`).catch(() => null);
    if (page && !page.blocked) {
      await db
        .insert(snapshots)
        .values({ id: id("snap"), entityId: entity.id, source: "rss", capturedAt: now, data: { title: page.title, url: page.finalUrl }, contentHash: page.contentHash })
        .onConflictDoNothing({ target: [snapshots.entityId, snapshots.source, snapshots.capturedAt] });
    }
  }

  // 3) Dedupe + persist + write material events.
  let wrote = 0;
  const channel = optionalEnv("SLACK_CHANNEL_ID") ?? "";
  for (const sig of detected) {
    const inserted = await db
      .insert(signalEvents)
      .values({
        id: id("sig"),
        entityId: entity.id,
        watchId: watch.id,
        kind: sig.kind,
        source: sig.kind.startsWith("web") || sig.kind === "funding" ? "web" : sig.kind === "rss_launch" ? "rss" : "github",
        eventTime: new Date(sig.eventTime),
        materiality: sig.materiality,
        assessment: sig.assessment,
        citationUrl: sig.citationUrl,
        dedupeKey: sig.dedupeKey,
        payload: sig.payload as object,
      })
      .onConflictDoNothing({ target: signalEvents.dedupeKey })
      .returning({ id: signalEvents.id });

    if (inserted.length === 0) continue; // already seen -> dedupe

    if (sig.materiality >= 60) {
      // Notion timeline (idempotent)
      if (watch.notionRecord && watch.notionPageId) {
        await withReceipt(
          { entityId: entity.id, actionType: "notion_timeline", targetApp: "notion", scopeKey: sig.dedupeKey },
          async () => {
            await connectors.notion.appendTimeline(watch.notionPageId!, { date: sig.eventTime.slice(0, 10), text: sig.assessment });
            return { externalObjectId: `${watch.notionPageId}:${sig.dedupeKey.slice(0, 8)}` };
          },
        );
      }
      // Founder Slack thread (idempotent)
      if (watch.slackMonitor && watch.slackThreadTs && channel) {
        await withReceipt(
          { entityId: entity.id, actionType: "slack_post", targetApp: "slack", scopeKey: sig.dedupeKey },
          async () => {
            const r = await connectors.slack.postToThread(channel, watch.slackThreadTs!, `:rotating_light: ${sig.assessment} ${sig.citationUrl ?? ""}`);
            return { externalObjectId: r.ts };
          },
        );
      }
      wrote++;
    }
  }

  await db.update(watches).set({ lastCheckedAt: now }).where(eq(watches.id, watch.id));
  return { entityId: entity.id, detected, wrote, degraded };
}
