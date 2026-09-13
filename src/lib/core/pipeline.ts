import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  scoutRuns,
  entities,
  identityCandidates,
  claims as claimsTable,
  dossiers,
  discoveredCompanies,
  type ScoutRun,
  type DiscoveredCompany,
} from "@/lib/db/schema";
import type { Connectors } from "@/lib/connectors/types";
import { liveConnectors } from "@/lib/connectors/registry";
import { id } from "@/lib/util/ids";
import type { InputKind, RunState } from "@/lib/schemas";
import { emit, transition } from "./events";
import { resolveIdentity, type EntityDraft } from "./resolver";
import { runResearch, type ResearchEntity } from "./agent";
import { discoverCompanies } from "./discovery";
import { createCompanyDiligence } from "./writer";
import { startTrace, type Span, type Trace } from "@/lib/observability/langfuse";

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

  // Thesis-first flow (the product's primary path).
  if (run.inputKind === "thesis") {
    await executeThesisRun(run, { connectors, deadline, trace: opts.trace });
    return;
  }

  const trace =
    opts.trace ??
    startTrace("scout-run", {
      run_id: runId,
      input_kind: run.inputKind,
      thesis_category: run.thesis ? "provided" : "none",
      model: run.model ?? "claude-sonnet-5",
    });

  try {
    // Step 1: identity resolution
    if (run.state === "CREATED") {
      await transition(runId, "CREATED", "RESOLVING_IDENTITY");
      const span = trace.span("resolve-identity", { inputKind: run.inputKind });
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

// ---- Thesis-first pipeline ---------------------------------------------------

const MAX_COMPANY_CONCURRENCY = 3;

/**
 * Drive a thesis run:
 *   CREATED           -> discover 5-8 companies -> AWAITING_SELECTION
 *   RESEARCHING        -> (after user selection) diligence selected companies in
 *                         parallel (research + gated writes) -> COMPLETED
 * A trace is only created when real work runs, so re-opening a finished run
 * never produces empty Langfuse traces.
 */
async function executeThesisRun(
  run: ScoutRun,
  opts: { connectors: Connectors; deadline: number; trace?: Trace },
): Promise<void> {
  const { connectors, deadline } = opts;
  const runId = run.id;

  if (run.state === "CREATED") {
    const trace = opts.trace ?? startTrace("scout-discovery", { run_id: runId });
    try {
      await transition(runId, "CREATED", "DISCOVERING");
      const outcome = await discoverCompanies({
        thesis: run.input,
        connectors,
        trace,
        deadline,
        emit: async (event, payload) => {
          await emit(runId, event as never, payload);
        },
      });
      if (outcome.status === "review_needed") {
        await transition(runId, "DISCOVERING", "REVIEW_NEEDED");
        await emit(runId, "run.error", { reason: outcome.reason, recoverable: true });
        await trace.end();
        return;
      }
      let rank = 1;
      for (const c of outcome.companies) {
        await db.insert(discoveredCompanies).values({
          id: id("cmp"),
          runId,
          rank: rank++,
          name: c.name,
          domain: c.domain ?? null,
          githubOrg: c.githubOrg ?? null,
          oneLiner: c.oneLiner,
          whyMatch: c.whyMatch,
          raw: c as object,
          // Default: all delivery options ON (user can toggle before diligence).
          selected: false,
          optSlack: true,
          optEmail: true,
          optNotion: true,
        });
      }
      await emit(runId, "companies.discovered", { count: outcome.companies.length });
      await transition(runId, "DISCOVERING", "AWAITING_SELECTION");
      await trace.end();
    } catch (e) {
      await failRun(runId, e, "DISCOVERING");
      await trace.end().catch(() => {});
    }
    return;
  }

  if (run.state === "RESEARCHING") {
    const pending = await db
      .select()
      .from(discoveredCompanies)
      .where(and(eq(discoveredCompanies.runId, runId), eq(discoveredCompanies.selected, true)));
    const todo = pending.filter((c) => c.status === "pending" || c.status === "failed");
    if (todo.length === 0) {
      await finishThesisRun(runId);
      return;
    }
    const trace = opts.trace ?? startTrace("scout-diligence", { run_id: runId, companies: todo.length });
    try {
      await runWithConcurrency(todo, MAX_COMPANY_CONCURRENCY, (company) =>
        diligenceCompany(runId, run.thesis ?? run.input, company, connectors, trace, deadline),
      );
      await finishThesisRun(runId);
      await trace.end();
    } catch (e) {
      await failRun(runId, e, "RESEARCHING");
      await trace.end().catch(() => {});
    }
    return;
  }

  // AWAITING_SELECTION (waiting on the user) or terminal: nothing to drive, no trace.
}

/** Research + gated writes for a single discovered company. Isolated so one
 *  company failing never aborts the others. */
async function diligenceCompany(
  runId: string,
  thesis: string,
  company: DiscoveredCompany,
  connectors: Connectors,
  trace: Trace,
  deadline: number,
): Promise<void> {
  const cSpan = trace.span("research-company", { rank: company.rank, name: company.name, companyId: company.id });
  try {
    await db
      .update(discoveredCompanies)
      .set({ status: "researching", updatedAt: new Date() })
      .where(eq(discoveredCompanies.id, company.id));
    await emit(runId, "company.research.started", { companyId: company.id, name: company.name });

    const entityId = await createEntityRecord({
      kind: "company",
      canonicalName: company.name,
      companyDomain: company.domain ?? undefined,
      companyGithubOrg: company.githubOrg ?? undefined,
      identityConfidence: 0.85,
    });
    await db
      .update(discoveredCompanies)
      .set({ entityId, updatedAt: new Date() })
      .where(eq(discoveredCompanies.id, company.id));

    const researchEntity: ResearchEntity = {
      id: entityId,
      kind: "company",
      canonicalName: company.name,
      companyDomain: company.domain ?? null,
      companyGithubOrg: company.githubOrg ?? null,
      identityConfidence: 0.85,
    };

    // Nest this company's model/tool spans under its own span.
    const companyTrace = childTrace(trace, cSpan);
    const outcome = await runResearch({
      runId,
      entity: researchEntity,
      thesis,
      connectors,
      trace: companyTrace,
      deadline,
    });

    if (outcome.status === "review_needed") {
      await db
        .update(discoveredCompanies)
        .set({ status: "failed", error: outcome.reason, updatedAt: new Date() })
        .where(eq(discoveredCompanies.id, company.id));
      await emit(runId, "company.research.completed", { companyId: company.id, ok: false, reason: outcome.reason });
      cSpan.end({ status: "review_needed", reason: outcome.reason });
      return;
    }

    // Persist claims + dossier for this company.
    for (const c of outcome.synthesis.claims) {
      await db.insert(claimsTable).values({
        id: id("claim"),
        runId,
        entityId,
        category: c.category,
        text: c.text,
        confidence: c.confidence ?? null,
        sourceIds: c.sourceIds,
        status: "validated",
      });
    }
    const dossierId = id("dossier");
    await db.insert(dossiers).values({
      id: dossierId,
      runId,
      entityId,
      whyNow: outcome.synthesis.whyNow,
      summary: outcome.synthesis.summary,
      opportunityScore: outcome.opportunity.opportunity,
      confidenceScore: outcome.confidence,
      scoreBreakdown: { opportunity: outcome.opportunity, confidenceInputs: outcome.synthesis.confidenceInputs },
      label: outcome.opportunity.label,
      timeline: outcome.synthesis.timeline,
    });
    await db
      .update(discoveredCompanies)
      .set({
        dossierId,
        opportunityScore: outcome.opportunity.opportunity,
        confidenceScore: outcome.confidence,
        label: outcome.opportunity.label,
        whyNow: outcome.synthesis.whyNow,
        summary: outcome.synthesis.summary,
        updatedAt: new Date(),
      })
      .where(eq(discoveredCompanies.id, company.id));
    await emit(runId, "company.research.completed", {
      companyId: company.id,
      ok: true,
      opportunity: outcome.opportunity.opportunity,
      confidence: outcome.confidence,
      label: outcome.opportunity.label,
    });

    // Gated writes (Doc always; Slack/Notion/email per selection).
    await createCompanyDiligence({
      runId,
      entityId,
      thesis,
      options: { slack: company.optSlack, email: company.optEmail, notion: company.optNotion },
      connectors,
      trace: companyTrace,
    });
    await emit(runId, "company.diligence.completed", { companyId: company.id, name: company.name });
    cSpan.end({ status: "ready", opportunity: outcome.opportunity.opportunity, confidence: outcome.confidence });
  } catch (e) {
    const message = e instanceof Error ? e.message : "company-diligence-error";
    await db
      .update(discoveredCompanies)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(discoveredCompanies.id, company.id));
    await emit(runId, "company.research.completed", { companyId: company.id, ok: false, reason: message });
    cSpan.end({ error: message });
  }
}

async function finishThesisRun(runId: string): Promise<void> {
  const [cur] = await db.select({ state: scoutRuns.state }).from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (cur && cur.state === "RESEARCHING") {
    await transition(runId, "RESEARCHING", "COMPLETED");
    await emit(runId, "run.finished", {});
  }
}

async function failRun(runId: string, e: unknown, from: RunState): Promise<void> {
  const message = e instanceof Error ? e.message : "pipeline-error";
  await db.update(scoutRuns).set({ error: message }).where(eq(scoutRuns.id, runId));
  await emit(runId, "run.error", { reason: message, recoverable: true });
  const [cur] = await db.select({ state: scoutRuns.state }).from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (cur && cur.state !== "FAILED_TERMINAL" && cur.state !== "COMPLETED") {
    await db.update(scoutRuns).set({ state: "FAILED_RETRYABLE" }).where(eq(scoutRuns.id, runId));
    await emit(runId, "state.changed", { from, to: "FAILED_RETRYABLE" });
  }
}

/** Bounded-concurrency map (pool). Preserves the isolation of each task. */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** A Trace view whose spans nest under `parent` and whose end() is a no-op
 *  (the owning caller ends the real trace once). */
function childTrace(trace: Trace, parent: Span): Trace {
  return {
    id: trace.id,
    span: (name, input) => trace.span(name, input, parent),
    tool: (name, input) => trace.tool(name, input, parent),
    generation: (name, input, opts) => trace.generation(name, input, { ...opts, parent }),
    score: (name, value, comment) => trace.score(name, value, comment),
    update: (output) => trace.update(output),
    end: async () => {},
  };
}

/** Insert an entity record WITHOUT mutating scoutRuns.entityId (a thesis run has
 *  many entities). */
export async function createEntityRecord(draft: EntityDraft): Promise<string> {
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
  return entityId;
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
