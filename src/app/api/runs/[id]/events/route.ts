import { db } from "@/lib/db/client";
import { scoutRuns, identityCandidates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getEventsSince } from "@/lib/core/events";
import type { RunState } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sse(seq: number, type: string, data: unknown): string {
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A settled state means the client should stop waiting for automatic progress
 *  and take an action (confirm identity, review dossier, or acknowledge failure). */
async function isSettled(runId: string, state: RunState): Promise<boolean> {
  if (
    ["AWAITING_SELECTION", "READY_FOR_REVIEW", "REVIEW_NEEDED", "COMPLETED", "WATCHING", "FAILED_TERMINAL", "CANCELLED"].includes(
      state,
    )
  ) {
    return true;
  }
  if (state === "RESOLVING_IDENTITY") {
    const c = await db.select({ id: identityCandidates.id }).from(identityCandidates).where(eq(identityCandidates.runId, runId)).limit(1);
    return c.length > 0; // awaiting explicit confirmation
  }
  return false;
}

/**
 * SSE stream. Supports Last-Event-ID (header or ?lastEventId=) so a reconnecting
 * client replays only persisted events it missed, then live-tails new events.
 * The UI can rebuild its entire state from this event history alone.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const url = new URL(req.url);
  const headerId = req.headers.get("last-event-id");
  const queryId = url.searchParams.get("lastEventId");
  let cursor = Number(headerId ?? queryId ?? 0) || 0;

  const encoder = new TextEncoder();
  const deadline = Date.now() + 280_000;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (seq: number, type: string, data: unknown) => controller.enqueue(encoder.encode(sse(seq, type, data)));
      // Advise client to retry after 3s if the connection drops.
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      try {
        while (Date.now() < deadline) {
          const events = await getEventsSince(runId, cursor);
          for (const ev of events) {
            send(ev.seq, ev.type, ev.payload ?? {});
            cursor = ev.seq;
          }

          const [run] = await db.select({ state: scoutRuns.state }).from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
          if (!run) {
            send(cursor, "run.error", { reason: "run not found" });
            break;
          }
          if (await isSettled(runId, run.state as RunState)) {
            send(cursor, "stream.settled", { state: run.state });
            break;
          }
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (e) {
        send(cursor, "run.error", { reason: e instanceof Error ? e.message : "stream-error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
