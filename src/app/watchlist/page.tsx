import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { watches, entities, signalEvents } from "@/lib/db/schema";
import { Badge, Card, CardTitle, Eyebrow, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Watchlist grouped by founder/company with a signal timeline. */
export default async function WatchlistPage() {
  const activeWatches = await db.select().from(watches).where(eq(watches.active, true));
  const entityIds = activeWatches.map((w) => w.entityId);
  const ents = entityIds.length ? await db.select().from(entities).where(inArray(entities.id, entityIds)) : [];
  const entityById = new Map(ents.map((e) => [e.id, e]));

  const events = entityIds.length
    ? await db.select().from(signalEvents).where(inArray(signalEvents.entityId, entityIds)).orderBy(desc(signalEvents.eventTime))
    : [];
  const eventsByEntity = new Map<string, typeof events>();
  for (const ev of events) {
    const arr = eventsByEntity.get(ev.entityId) ?? [];
    arr.push(ev);
    eventsByEntity.set(ev.entityId, arr);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <Eyebrow>Continuous diligence</Eyebrow>
        <PageTitle
          sub="Material signals (event score ≥ 60) post to Notion + Slack and appear here. Minor activity is stored silently to prevent alert fatigue."
        >
          Watchlist
        </PageTitle>
      </section>

      {activeWatches.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No active watches yet. Approve a diligence pack from a run to start watching.
          </p>
        </Card>
      ) : null}

      <div className="space-y-4">
        {activeWatches.map((w) => {
          const entity = entityById.get(w.entityId);
          const evs = eventsByEntity.get(w.entityId) ?? [];
          const material = evs.filter((e) => e.materiality >= 60);
          return (
            <Card key={w.id}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  {entity?.canonicalName ?? w.entityId}
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {w.terminalFailure ? <Badge tone="bad">Source failure</Badge> : null}
                  {w.slackMonitor ? <Badge tone="neutral">Slack</Badge> : null}
                  {w.weeklyEmail ? <Badge tone="neutral">Newsletter</Badge> : null}
                  {w.notionRecord ? <Badge tone="neutral">Notion</Badge> : null}
                  <Badge tone="good">{material.length} material</Badge>
                  <Badge tone="neutral">{evs.length} total</Badge>
                </div>
              </div>
              {evs.length === 0 ? (
                <p className="text-sm text-slate-500">No signals detected yet.</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {evs.slice(0, 12).map((ev) => (
                    <li key={ev.id} className="flex items-start gap-3">
                      <Badge tone={ev.materiality >= 60 ? "good" : "neutral"}>{ev.materiality}</Badge>
                      <span className="leading-relaxed text-slate-600">
                        <span className="font-medium text-slate-900">{ev.kind}</span> — {ev.assessment}{" "}
                        {ev.citationUrl ? (
                          <a
                            href={ev.citationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-slate-900 underline-offset-4 hover:underline"
                          >
                            source
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {w.runId ? (
                <Link
                  href={`/runs/${w.runId}`}
                  className="mt-4 inline-flex text-xs font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  View diligence pack →
                </Link>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
