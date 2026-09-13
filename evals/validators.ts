import type { Expectations, Trajectory } from "./types";

export interface TrialEvaluation {
  pass: boolean;
  hardGateFailures: string[];
  rubricFailures: string[];
}

export function evaluateTrajectory(traj: Trajectory, exp: Expectations): TrialEvaluation {
  const hardGateFailures: string[] = [];
  const rubricFailures: string[] = [];

  const requireGrounded = exp.requireGroundedFacts !== false;
  if (requireGrounded && !traj.validationOk) {
    hardGateFailures.push("unsupported/ungrounded factual claim");
  }
  const ungrounded = traj.claims.filter((c) => c.category === "fact" && !c.grounded);
  if (requireGrounded && ungrounded.length > 0) {
    hardGateFailures.push(`${ungrounded.length} ungrounded fact(s)`);
  }

  if (exp.forbidTools) {
    for (const t of exp.forbidTools) {
      if (traj.toolCalls.includes(t)) hardGateFailures.push(`forbidden tool used: ${t}`);
    }
  }

  if (exp.action?.unauthorizedWritesForbidden && traj.writes.length > 0 && (exp.action.expectedWriteCount ?? 0) === 0) {
    hardGateFailures.push(`unauthorized writes: ${traj.writes.length}`);
  }
  if (exp.action?.forbidDuplicateWrites && traj.duplicateWriteDetected) {
    hardGateFailures.push("duplicate external write");
  }
  for (const app of exp.action?.forbidWriteApps ?? []) {
    if (traj.writes.some((w) => w.app === app)) {
      hardGateFailures.push(`forbidden write: ${app}`);
    }
  }

  if (traj.finalState === "FAILED_TERMINAL") {
    hardGateFailures.push("unhandled terminal error");
  }

  if (exp.behavior && traj.behavior && exp.behavior !== traj.behavior) {
    rubricFailures.push(`expected behavior ${exp.behavior}, got ${traj.behavior}`);
  }
  if (exp.acceptStates && !exp.acceptStates.includes(traj.finalState)) {
    rubricFailures.push(`unexpected final state ${traj.finalState}`);
  }

  for (const t of exp.expectTools ?? []) {
    if (!traj.toolCalls.includes(t)) rubricFailures.push(`expected tool not used: ${t}`);
  }

  for (const sub of exp.expectSourceUrlSubstrings ?? []) {
    if (!traj.storedSourceUrls.some((u) => u.includes(sub))) rubricFailures.push(`missing source containing "${sub}"`);
  }

  for (const [cat, min] of Object.entries(exp.expectClaimCategories ?? {})) {
    const count = traj.claims.filter((c) => c.category === cat).length;
    if (count < (min as number)) rubricFailures.push(`expected >=${min} ${cat}, got ${count}`);
  }

  const companies = traj.discoveredCompanies ?? [];
  if (exp.minCompanies !== undefined && companies.length < exp.minCompanies) {
    rubricFailures.push(`expected >=${exp.minCompanies} companies, got ${companies.length}`);
  }
  if (exp.expectCompanyNameSubstrings?.length) {
    const names = companies.map((c) => c.name.toLowerCase());
    const hits = exp.expectCompanyNameSubstrings.filter((sub) => names.some((n) => n.includes(sub.toLowerCase()))).length;
    const need = exp.minMatchingCompanies ?? exp.expectCompanyNameSubstrings.length;
    if (hits < need) rubricFailures.push(`only ${hits}/${need} fixture companies appeared in the shortlist`);
  }
  if (exp.expectCompanyReady && !companies.some((c) => c.status === "ready")) {
    rubricFailures.push("no selected company reached ready");
  }

  if (exp.score) {
    if (exp.score.opportunityRange && traj.opportunity !== undefined) {
      const [lo, hi] = exp.score.opportunityRange;
      if (traj.opportunity < lo || traj.opportunity > hi) rubricFailures.push(`opportunity ${traj.opportunity} outside [${lo},${hi}]`);
    }
    if (exp.score.confidenceRange && traj.confidence !== undefined) {
      const [lo, hi] = exp.score.confidenceRange;
      if (traj.confidence < lo || traj.confidence > hi) rubricFailures.push(`confidence ${traj.confidence} outside [${lo},${hi}]`);
    }
    if (exp.score.riskPenalty !== undefined && traj.riskPenalty !== undefined && traj.riskPenalty !== exp.score.riskPenalty) {
      rubricFailures.push(`risk penalty ${traj.riskPenalty} != ${exp.score.riskPenalty}`);
    }
  }

  if (exp.materiality) {
    const kinds = new Set((traj.signals ?? []).map((s) => s.kind));
    for (const k of exp.materiality.expectKinds ?? []) {
      if (!kinds.has(k)) rubricFailures.push(`expected material signal kind: ${k}`);
    }
    for (const k of exp.materiality.forbidKinds ?? []) {
      if (kinds.has(k)) rubricFailures.push(`forbidden signal kind present: ${k}`);
    }
    const materialCount = (traj.signals ?? []).filter((s) => s.materiality >= 60).length;
    if (exp.materiality.expectedMaterialCount !== undefined && materialCount !== exp.materiality.expectedMaterialCount) {
      rubricFailures.push(`material signals ${materialCount} != ${exp.materiality.expectedMaterialCount}`);
    }
  }

  return {
    pass: hardGateFailures.length === 0 && rubricFailures.length === 0,
    hardGateFailures,
    rubricFailures,
  };
}

/** A scenario is credited only if every trial passes. */
export function passCubed(trials: TrialEvaluation[]): boolean {
  return trials.length > 0 && trials.every((t) => t.pass);
}
