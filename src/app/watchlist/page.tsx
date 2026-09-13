import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { watches, entities, signalEvents } from "@/lib/db/schema";
import { Badge, Card, CardTitle } from "@/components/ui";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <p className="mt-1 text-sm text-muted">
          Material signals (event score ≥ 60) post to Notion + Slack and appear here. Minor activity is
          stored silently to prevent alert fatigue.
        </p>
      </div>

      {activeWatches.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No active watches yet. Approve a diligence pack from a run to start watching.
          </p>
        </Card>
      ) : null}

      {activeWatches.map((w) => {
        const entity = entityById.get(w.entityId);
        const evs = eventsByEntity.get(w.entityId) ?? [];
        const material = evs.filter((e) => e.materiality >= 60);
        return (
          <Card key={w.id}>
            <div className="mb-3 flex items-center justify-between">
              <CardTitle>{entity?.canonicalName ?? w.entityId}</CardTitle>
              <div className="flex items-center gap-2">
                {w.terminalFailure ? <Badge tone="bad">source failure</Badge> : null}
                <Badge tone="accent">{material.length} material</Badge>
                <Badge tone="neutral">{evs.length} total</Badge>
              </div>
            </div>
            {evs.length === 0 ? (
              <p className="text-xs text-muted">No signals detected yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {evs.slice(0, 12).map((ev) => (
                  <li key={ev.id} className="flex items-start gap-2">
                    <Badge tone={ev.materiality >= 60 ? "good" : "neutral"}>{ev.materiality}</Badge>
                    <span className="text-muted">
                      <span className="text-text">{ev.kind}</span> — {ev.assessment}{" "}
                      {ev.citationUrl ? (
                        <a href={ev.citationUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                          source
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {w.runId ? (
              <Link href={`/runs/${w.runId}`} className="mt-3 inline-block text-xs text-accent hover:underline">
                Open dossier →
              </Link>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
