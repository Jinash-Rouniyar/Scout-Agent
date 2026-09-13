import type { RunState } from "@/lib/schemas";

/**
 * Scout run lifecycle.
 *
 *   CREATED
 *     -> RESOLVING_IDENTITY
 *     -> RESEARCHING
 *     -> VALIDATING
 *     -> READY_FOR_REVIEW
 *     -> CREATING_DILIGENCE_PACK
 *     -> WATCHING
 *     -> COMPLETED
 *
 * REVIEW_NEEDED is a terminal-for-this-invocation state used when a synchronous
 * research request cannot finish within its function budget; the persisted run
 * can be re-executed.
 *
 * Any state -> FAILED_RETRYABLE | FAILED_TERMINAL | CANCELLED
 */
const TRANSITIONS: Record<RunState, RunState[]> = {
  // Thesis-first flow: CREATED -> DISCOVERING -> AWAITING_SELECTION -> RESEARCHING
  //   -> CREATING_DILIGENCE_PACK -> COMPLETED.
  CREATED: ["DISCOVERING", "RESOLVING_IDENTITY", "CANCELLED", "FAILED_TERMINAL"],
  DISCOVERING: ["AWAITING_SELECTION", "REVIEW_NEEDED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"],
  AWAITING_SELECTION: ["RESEARCHING", "CANCELLED", "FAILED_TERMINAL"],
  RESOLVING_IDENTITY: ["RESEARCHING", "REVIEW_NEEDED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"],
  RESEARCHING: ["VALIDATING", "CREATING_DILIGENCE_PACK", "COMPLETED", "REVIEW_NEEDED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"],
  VALIDATING: ["READY_FOR_REVIEW", "REVIEW_NEEDED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"],
  READY_FOR_REVIEW: ["CREATING_DILIGENCE_PACK", "CANCELLED", "FAILED_RETRYABLE"],
  REVIEW_NEEDED: ["DISCOVERING", "RESEARCHING", "VALIDATING", "READY_FOR_REVIEW", "CANCELLED"],
  CREATING_DILIGENCE_PACK: ["COMPLETED", "WATCHING", "READY_FOR_REVIEW", "FAILED_RETRYABLE", "CANCELLED"],
  WATCHING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  FAILED_RETRYABLE: ["DISCOVERING", "RESOLVING_IDENTITY", "RESEARCHING", "VALIDATING", "CANCELLED", "FAILED_TERMINAL"],
  FAILED_TERMINAL: [],
  CANCELLED: [],
};

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal run state transition: ${from} -> ${to}`);
  }
}

export function isTerminal(state: RunState): boolean {
  return state === "COMPLETED" || state === "FAILED_TERMINAL" || state === "CANCELLED";
}
