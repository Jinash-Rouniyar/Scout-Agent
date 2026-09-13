import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { runEvents, scoutRuns } from "@/lib/db/schema";
import type { RunState } from "@/lib/schemas";
import { assertTransition } from "./stateMachine";

export type RunEventType =
  | "run.created"
  | "state.changed"
  | "discovery.tool"
  | "companies.discovered"
  | "company.selected"
  | "company.research.started"
  | "company.research.completed"
  | "company.diligence.completed"
  | "identity.candidates"
  | "identity.confirmed"
  | "tool.call"
  | "tool.result"
  | "source.stored"
  | "claim.added"
  | "synthesis.completed"
  | "validation.result"
  | "dossier.ready"
  | "action.proposed"
  | "action.receipt"
  | "signal.detected"
  | "run.finished"
  | "run.error";

/**
 * Append a durable run event. The bigserial `seq` is the monotonic id used as
 * the SSE id / Last-Event-ID cursor, so the UI can rebuild state purely from
 * persisted history after a refresh or reconnect.
 */
export async function emit(runId: string, type: RunEventType, payload?: unknown): Promise<number> {
  const [row] = await db
    .insert(runEvents)
    .values({ runId, type, payload: (payload ?? null) as object })
    .returning({ seq: runEvents.seq });
  return row.seq;
}

export async function getEventsSince(runId: string, sinceSeq: number) {
  return db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, sinceSeq)))
    .orderBy(asc(runEvents.seq));
}

export async function getAllEvents(runId: string) {
  return getEventsSince(runId, 0);
}

/** Transition a run's state, persisting it and emitting a state.changed event. */
export async function transition(runId: string, from: RunState, to: RunState): Promise<void> {
  assertTransition(from, to);
  await db.update(scoutRuns).set({ state: to }).where(eq(scoutRuns.id, runId));
  await emit(runId, "state.changed", { from, to });
}
