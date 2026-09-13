import { db } from "@/lib/db/client";
import { scoutRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { executeRun } from "@/lib/core/pipeline";
import { getEventsSince } from "@/lib/core/events";

export const dynamic = "force-dynamic";
// Hard function duration. If research cannot finish in this budget the pipeline
// persists REVIEW_NEEDED rather than assuming any background continuation.
export const maxDuration = 300;

function sse(seq: number, type: string, data: unknown): string {
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Drives a run's bounded research synchronously and streams the persisted
 * events as they are written. This is the authoritative "who runs the agent"
 * path: the work happens inside this request; when the client disconnects the
 * function may stop, but all progress is durable and the run can be re-executed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (!run) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  const deadline = Date.now() + 280_000;

  const stream = new ReadableStream({
    async start(controller) {
      let cursor = 0;
      let closed = false;
      const send = (seq: number, type: string, data: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(sse(seq, type, data)));
      };
      send(0, "execute.started", { runId, state: run.state });

      // Tail persisted events while the pipeline runs.
      const pump = async () => {
        const events = await getEventsSince(runId, cursor);
        for (const ev of events) {
          send(ev.seq, ev.type, ev.payload ?? {});
          cursor = ev.seq;
        }
      };

      // Kick off the driver; do not await before starting the pump loop.
      const work = executeRun(runId, { deadline }).catch((e) => {
        send(cursor, "run.error", { reason: e instanceof Error ? e.message : "execute-error" });
      });

      try {
        let done = false;
        work.finally(() => {
          done = true;
        });
        while (!done && Date.now() < deadline) {
          await pump();
          await new Promise((r) => setTimeout(r, 400));
        }
        await work;
        await pump(); // flush any trailing events
        const [after] = await db.select({ state: scoutRuns.state }).from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
        send(cursor, "execute.finished", { state: after?.state });
      } catch (e) {
        send(cursor, "run.error", { reason: e instanceof Error ? e.message : "execute-error" });
      } finally {
        closed = true;
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
