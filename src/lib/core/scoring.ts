import type { ConfidenceInputs, OpportunityInputs } from "@/lib/schemas";

/**
 * Exact conviction model. Code owns the formula, weights, bands, risk penalty,
 * labels, and final values. The model may only choose fixed rubric band values
 * (0/25/50/75/100) and explain them; it can never alter the arithmetic here.
 */

export const OPPORTUNITY_WEIGHTS = {
  technical: 0.35,
  momentum: 0.25,
  thesisFit: 0.2,
  companyMarket: 0.2,
} as const;

export const CONFIDENCE_WEIGHTS = {
  sourceQuality: 0.4,
  corroboration: 0.3,
  recency: 0.2,
  entityResolutionCertainty: 0.1,
} as const;

export const RISK_PER_FACT = 5;
export const RISK_MAX = 15;

export interface OpportunityResult {
  base: number;
  riskPenalty: number;
  opportunity: number;
  label: OpportunityLabel;
  breakdown: {
    technical: number;
    momentum: number;
    thesisFit: number;
    companyMarket: number;
    weighted: {
      technical: number;
      momentum: number;
      thesisFit: number;
      companyMarket: number;
    };
  };
}

export type OpportunityLabel =
  | "High conviction"
  | "Promising"
  | "Watch"
  | "Low current conviction";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Verified-risk penalty: -5 per verified negative fact, capped at -15.
 *  Missing information is NEVER a penalty (it lowers confidence instead). */
export function riskPenalty(verifiedRiskFacts: number): number {
  return Math.min(Math.max(verifiedRiskFacts, 0) * RISK_PER_FACT, RISK_MAX);
}

export function opportunityLabel(score: number): OpportunityLabel {
  if (score >= 80) return "High conviction";
  if (score >= 65) return "Promising";
  if (score >= 45) return "Watch";
  return "Low current conviction";
}

export function computeOpportunity(inputs: OpportunityInputs): OpportunityResult {
  const wt = OPPORTUNITY_WEIGHTS;
  const weighted = {
    technical: inputs.technical * wt.technical,
    momentum: inputs.momentum * wt.momentum,
    thesisFit: inputs.thesisFit * wt.thesisFit,
    companyMarket: inputs.companyMarket * wt.companyMarket,
  };
  const base = weighted.technical + weighted.momentum + weighted.thesisFit + weighted.companyMarket;
  const penalty = riskPenalty(inputs.verifiedRiskFacts);
  const opportunity = clamp(Math.round(base - penalty), 0, 100);
  return {
    base,
    riskPenalty: penalty,
    opportunity,
    label: opportunityLabel(opportunity),
    breakdown: {
      technical: inputs.technical,
      momentum: inputs.momentum,
      thesisFit: inputs.thesisFit,
      companyMarket: inputs.companyMarket,
      weighted,
    },
  };
}

export function computeConfidence(inputs: ConfidenceInputs): number {
  const w = CONFIDENCE_WEIGHTS;
  const value =
    inputs.sourceQuality * w.sourceQuality +
    inputs.corroboration * w.corroboration +
    inputs.recency * w.recency +
    inputs.entityResolutionCertainty * w.entityResolutionCertainty;
  return clamp(Math.round(value), 0, 100);
}
