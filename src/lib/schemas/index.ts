import { z } from "zod";

// ---- Run states --------------------------------------------------------------

export const RUN_STATES = [
  "CREATED",
  "DISCOVERING",
  "AWAITING_SELECTION",
  "RESOLVING_IDENTITY",
  "RESEARCHING",
  "VALIDATING",
  "READY_FOR_REVIEW",
  "REVIEW_NEEDED",
  "CREATING_DILIGENCE_PACK",
  "WATCHING",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "CANCELLED",
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const InputKind = z.enum(["thesis", "github_url", "company_url", "profile_url", "name"]);
export type InputKind = z.infer<typeof InputKind>;

// ---- Claims ------------------------------------------------------------------

export const ClaimCategory = z.enum(["fact", "interpretation", "risk", "open_question"]);
export type ClaimCategory = z.infer<typeof ClaimCategory>;

export const ClaimSchema = z.object({
  id: z.string(),
  category: ClaimCategory,
  text: z.string().min(1),
  // Facts must cite >=1 source; interpretations point at the facts/sources they
  // interpret; risks/open-questions may be uncited but are labeled.
  sourceIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

// ---- Scoring -----------------------------------------------------------------

export const ScoreBandValue = z.union([
  z.literal(0),
  z.literal(25),
  z.literal(50),
  z.literal(75),
  z.literal(100),
]);
export type ScoreBandValue = z.infer<typeof ScoreBandValue>;

export const OpportunityInputs = z.object({
  technical: ScoreBandValue,
  momentum: ScoreBandValue,
  thesisFit: ScoreBandValue,
  companyMarket: ScoreBandValue,
  // number of verified negative facts; penalty = min(count*5, 15)
  verifiedRiskFacts: z.number().int().min(0).default(0),
});
export type OpportunityInputs = z.infer<typeof OpportunityInputs>;

export const ConfidenceInputs = z.object({
  sourceQuality: z.number().min(0).max(100),
  corroboration: z.number().min(0).max(100),
  recency: z.number().min(0).max(100),
  entityResolutionCertainty: z.number().min(0).max(100),
});
export type ConfidenceInputs = z.infer<typeof ConfidenceInputs>;

// ---- Model synthesis output (what Claude must return) ------------------------

export const SynthesisSchema = z.object({
  whyNow: z.string(),
  summary: z.string(),
  claims: z.array(ClaimSchema),
  // The model chooses band values against fixed rubrics; code owns the formula.
  opportunityInputs: OpportunityInputs,
  confidenceInputs: ConfidenceInputs,
  openQuestions: z.array(z.string()).default([]),
  timeline: z
    .array(z.object({ date: z.string(), text: z.string() }))
    .default([]),
});
export type Synthesis = z.infer<typeof SynthesisSchema>;

// ---- Actions -----------------------------------------------------------------

export const ActionType = z.enum([
  "notion_page",
  "notion_timeline",
  "slack_thread",
  "slack_post",
  "google_doc",
  "gmail_recap",
]);
export type ActionType = z.infer<typeof ActionType>;

// ---- Materiality -------------------------------------------------------------

export const SignalKind = z.enum([
  "funding",
  "company_launch",
  "new_repo",
  "release",
  "star_growth",
  "contributors",
  "rss_launch",
  "web_launch",
  "noise",
]);
export type SignalKind = z.infer<typeof SignalKind>;

export const ALERT_THRESHOLD = 60;
