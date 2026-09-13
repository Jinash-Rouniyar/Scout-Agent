import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scoutRuns } from "@/lib/db/schema";
import { transition, emit } from "@/lib/core/events";
import { createDiligencePack } from "@/lib/core/writer";
import { startTrace } from "@/lib/observability/langfuse";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Batch-approve the diligence pack: create Notion page + Google Doc + Slack
 * thread (idempotent, receipted), then start watching.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.state !== "READY_FOR_REVIEW") {
    return NextResponse.json({ error: `run must be READY_FOR_REVIEW (is ${run.state})` }, { status: 409 });
  }

  const trace = startTrace("scout.diligence_pack", { run_id: runId });
  await transition(runId, "READY_FOR_REVIEW", "CREATING_DILIGENCE_PACK");

  try {
    const pack = await createDiligencePack(runId, undefined, trace);
    await transition(runId, "CREATING_DILIGENCE_PACK", "WATCHING");
    await emit(runId, "signal.detected", { note: "watch active", watching: true });
    await trace.end();
    return NextResponse.json({ ok: true, pack });
  } catch (e) {
    const message = e instanceof Error ? e.message : "pack-failed";
    await emit(runId, "run.error", { reason: message, recoverable: true });
    // Return to review so the user can retry (idempotency prevents dupes).
    await db.update(scoutRuns).set({ state: "READY_FOR_REVIEW", error: message }).where(eq(scoutRuns.id, runId));
    await trace.end().catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
