import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scoutRuns, entities, identityCandidates, claims as claimsTable, dossiers } from "@/lib/db/schema";
import type { Connectors } from "@/lib/connectors/types";
import { liveConnectors } from "@/lib/connectors/registry";
import { id } from "@/lib/util/ids";
import type { InputKind, RunState } from "@/lib/schemas";
import { emit, transition } from "./events";
import { resolveIdentity, type EntityDraft } from "./resolver";
import { runResearch, type ResearchEntity } from "./agent";
import { startTrace, type Trace } from "@/lib/observability/langfuse";

export interface ExecuteOptions {
  connectors?: Connectors;
  deadline?: number;
  trace?: Trace;
}

/**
 * Drive a run forward from its persisted state. Safe to call repeatedly
 * (resumable): it performs the next step(s) until it reaches a waiting state
 * (identity confirmation, ready-for-review, review-needed) or a terminal state,
 * or the deadline is hit.
 */
export async function executeRun(runId: string, opts: ExecuteOptions = {}): Promise<void> {
  const connectors = opts.connectors ?? liveConnectors();
  const deadline = opts.deadline ?? Date.now() + 110_000;

  const run = await getRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);

  const trace =
    opts.trace ??
    startTrace("scout.run", {
      run_id: runId,
      input_kind: run.inputKind,
      thesis_category: run.thesis ? "provided" : "none",
      model: run.model ?? "claude-sonnet-5",
    });

  try {
    // Step 1: identity resolution
    if (run.state === "CREATED") {
      await transition(runId, "CREATED", "RESOLVING_IDENTITY");
      const span = trace.span("discovery:resolve", { inputKind: run.inputKind });
      const decision = await resolveIdentity(run.input, run.inputKind as InputKind, connectors);
      span.end({ status: decision.status });

      if (decision.status === "needs_confirmation") {
        // Persist candidates and wait for explicit user confirmation.
        for (const c of decision.candidates) {
          await db.insert(identityCandidates).values({
            id: id("cand"),
            runId,
            rank: c.rank,
            name: c.name,
            exaId: c.exaId,
            githubLogin: c.githubLogin,
            companyDomain: c.companyDomain,
            confidence: c.confidence,
            summary: c.summary,
            raw: (c.raw ?? null) as object,
          });
        }
        await emit(runId, "identity.candidates", {
          reason: decision.reason,
          candidates: decision.candidates,
          profileUrl: decision.profileUrl,
        });
        await trace.end();
        return; // waits in RESOLVING_IDENTITY for /resolve
      }

      // Auto-linked.
      const entityId = await createEntity(runId, decision.entity);
      await emit(runId, "identity.confirmed", { entityId, auto: true, confidence: decision.entity.identityConfidence });
    }

    // Step 2: research (requires a confirmed entity)
    const refreshed = await getRun(runId);
    if (!refreshed?.entityId) {
      // Still awaiting confirmation.
      await trace.end();
      return;
    }

    if (refreshed.state === "RESOLVING_IDENTITY" || refreshed.state === "REVIEW_NEEDED" || refreshed.state === "FAILED_RETRYABLE") {
      await claimResearching(runId, refreshed.state as RunState);
    }

    const current = await getRun(runId);
    if (current?.state !== "RESEARCHING") {
      // Another invocation is driving it, or it's already past research.
      await trace.end();
      return;
    }

    const entity = await getEntity(refreshed.entityId);
    if (!entity) throw new Error("entity missing");

    const researchEntity: ResearchEntity = {
      id: entity.id,
      kind: entity.kind as "person" | "company",
      canonicalName: entity.canonicalName,
      githubLogin: entity.githubLogin,
      companyDomain: entity.companyDomain,
      companyGithubOrg: entity.companyGithubOrg,
      profileUrl: entity.profileUrl,
      identityConfidence: entity.identityConfidence,
    };

    const outcome = await runResearch({
      runId,
      entity: researchEntity,
      thesis: refreshed.thesis,
      connectors,
      trace,
      deadline,
    });

    await db
      .update(scoutRuns)
      .set({ toolCallCount: outcome.budget.toolCalls, docFetchCount: outcome.budget.docs, model: "claude-sonnet-5" })
      .where(eq(scoutRuns.id, runId));

    if (outcome.status === "review_needed") {
      await transition(runId, "RESEARCHING", "REVIEW_NEEDED");
      await emit(runId, "run.error", { reason: outcome.reason, recoverable: true });
      await trace.end();
      return;
    }

    // Persist claims + dossier.
    await transition(runId, "RESEARCHING", "VALIDATING");
    for (const c of outcome.synthesis.claims) {
      await db.insert(claimsTable).values({
        id: id("claim"),
        runId,
        entityId: entity.id,
        category: c.category,
        text: c.text,
        confidence: c.confidence ?? null,
        sourceIds: c.sourceIds,
        status: "validated",
      });
      await emit(runId, "claim.added", { category: c.category });
    }

    await db.insert(dossiers).values({
      id: id("dossier"),
      runId,
      entityId: entity.id,
      whyNow: outcome.synthesis.whyNow,
      summary: outcome.synthesis.summary,
      opportunityScore: outcome.opportunity.opportunity,
      confidenceScore: outcome.confidence,
      scoreBreakdown: {
        opportunity: outcome.opportunity,
        confidenceInputs: outcome.synthesis.confidenceInputs,
      },
      label: outcome.opportunity.label,
      timeline: outcome.synthesis.timeline,
    });

    trace.score("grounded_claims", outcome.validation.stats.facts - outcome.validation.stats.ungroundedFacts);
    trace.score("opportunity", outcome.opportunity.opportunity);
    trace.score("confidence", outcome.confidence);

    await emit(runId, "synthesis.completed", {
      opportunity: outcome.opportunity.opportunity,
      confidence: outcome.confidence,
      label: outcome.opportunity.label,
    });

    await transition(runId, "VALIDATING", "READY_FOR_REVIEW");
    await emit(runId, "dossier.ready", {
      opportunity: outcome.opportunity.opportunity,
      confidence: outcome.confidence,
      label: outcome.opportunity.label,
      traceId: trace.id,
    });
    await trace.end();
  } catch (e) {
    const message = e instanceof Error ? e.message : "pipeline-error";
    await db.update(scoutRuns).set({ error: message }).where(eq(scoutRuns.id, runId));
    await emit(runId, "run.error", { reason: message, recoverable: false });
    const cur = await getRun(runId);
    if (cur && cur.state !== "FAILED_TERMINAL" && cur.state !== "COMPLETED") {
      await db.update(scoutRuns).set({ state: "FAILED_RETRYABLE" }).where(eq(scoutRuns.id, runId));
      await emit(runId, "state.changed", { from: cur.state, to: "FAILED_RETRYABLE" });
    }
    await trace.end().catch(() => {});
  }
}

async function getRun(runId: string) {
  const [row] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  return row ?? null;
}

async function getEntity(entityId: string) {
  const [row] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1);
  return row ?? null;
}

/** Atomically move to RESEARCHING to avoid two invocations both researching. */
async function claimResearching(runId: string, from: RunState): Promise<void> {
  await db.update(scoutRuns).set({ state: "RESEARCHING" }).where(eq(scoutRuns.id, runId));
  await emit(runId, "state.changed", { from, to: "RESEARCHING" });
}

export async function createEntity(runId: string, draft: EntityDraft): Promise<string> {
  const entityId = id("ent");
  await db.insert(entities).values({
    id: entityId,
    kind: draft.kind,
    canonicalName: draft.canonicalName,
    exaId: draft.exaId,
    githubLogin: draft.githubLogin,
    linkedGithubAccounts: draft.linkedGithubAccounts ?? [],
    companyDomain: draft.companyDomain,
    companyGithubOrg: draft.companyGithubOrg,
    companyRepos: draft.companyRepos ?? [],
    profileUrl: draft.profileUrl,
    identityConfidence: draft.identityConfidence,
    resolvedAt: new Date(),
  });
  await db.update(scoutRuns).set({ entityId }).where(eq(scoutRuns.id, runId));
  return entityId;
}
