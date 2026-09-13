import type { FixtureSet } from "@/lib/connectors/fixtures";

export type ClaimCategory = "fact" | "interpretation" | "risk" | "open_question";

export type ScenarioFamily =
  | "known_research"
  | "ambiguous_identity"
  | "insufficient_evidence"
  | "prompt_injection"
  | "connector_failure"
  | "duplicate_write"
  | "material_signal"
  | "noise_suppression";

export interface Expectations {
  /** Tools that MUST appear in the trajectory. */
  expectTools?: string[];
  /** Tools that must NOT appear. */
  forbidTools?: string[];
  /** Substrings that must be present among stored source URLs. */
  expectSourceUrlSubstrings?: string[];
  /** Minimum count per claim category. */
  expectClaimCategories?: Partial<Record<ClaimCategory, number>>;
  /** Whether all facts must be grounded (default true). */
  requireGroundedFacts?: boolean;
  score?: {
    opportunityRange?: [number, number];
    confidenceRange?: [number, number];
    riskPenalty?: number;
  };
  materiality?: {
    expectKinds?: string[];
    forbidKinds?: string[];
    expectedMaterialCount?: number;
    noiseAlertsForbidden?: boolean;
  };
  action?: {
    expectedWriteCount?: number;
    forbidDuplicateWrites?: boolean;
    unauthorizedWritesForbidden?: boolean;
  };
  behavior?: "auto_research" | "needs_confirmation" | "insufficient_evidence" | "ignore_injection";
  /** Terminal states considered acceptable for this scenario. */
  acceptStates?: string[];
}

export interface Scenario {
  id: string;
  family: ScenarioFamily;
  description: string;
  kind: "research" | "monitoring" | "duplicate_write";
  input: string;
  thesis?: string;
  fixtures: FixtureSet;
  /** For monitoring scenarios: baseline github snapshot + watch config. */
  monitoring?: {
    entity: {
      kind: "person" | "company";
      canonicalName: string;
      githubLogin?: string;
      companyDomain?: string;
      companyGithubOrg?: string;
      linkedGithubAccounts?: string[];
    };
    watchStartDaysAgo: number;
    baselineDaysAgo?: number;
    baselineGithub?: unknown;
    withThreadAndPage?: boolean;
  };
  expect: Expectations;
}

/** What a single real trial produced. */
export interface Trajectory {
  toolCalls: string[];
  storedSourceUrls: string[];
  claims: { category: ClaimCategory; text: string; grounded: boolean }[];
  validationOk: boolean;
  opportunity?: number;
  confidence?: number;
  riskPenalty?: number;
  writes: { app: string; method: string; externalId: string }[];
  duplicateWriteDetected?: boolean;
  signals?: { kind: string; materiality: number }[];
  finalState: string;
  behavior?: Expectations["behavior"];
  traceId?: string | null;
  error?: string;
}
