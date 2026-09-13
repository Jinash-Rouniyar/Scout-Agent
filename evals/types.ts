import type { FixtureSet } from "@/lib/connectors/fixtures";

export type ClaimCategory = "fact" | "interpretation" | "risk" | "open_question";

export type ScenarioFamily =
  | "thesis_discovery"
  | "thesis_diligence"
  | "prompt_injection"
  | "duplicate_write"
  | "material_signal"
  | "noise_suppression";

export interface Expectations {
  expectTools?: string[];
  forbidTools?: string[];
  expectSourceUrlSubstrings?: string[];
  expectClaimCategories?: Partial<Record<ClaimCategory, number>>;
  requireGroundedFacts?: boolean;
  minCompanies?: number;
  expectCompanyNameSubstrings?: string[];
  minMatchingCompanies?: number;
  expectCompanyReady?: boolean;
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
    forbidWriteApps?: string[];
  };
  behavior?: "auto_research" | "needs_confirmation" | "insufficient_evidence" | "ignore_injection" | "awaiting_selection";
  acceptStates?: string[];
}

export interface Scenario {
  id: string;
  title: string;
  family: ScenarioFamily;
  description: string;
  kind: "thesis_discovery" | "thesis_diligence" | "monitoring" | "duplicate_write";
  input: string;
  thesis?: string;
  fixtures: FixtureSet;
  seedCompany?: {
    name: string;
    domain?: string;
    githubOrg?: string;
    oneLiner: string;
    whyMatch: string;
    optSlack?: boolean;
    optEmail?: boolean;
    optNotion?: boolean;
  };
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
  discoveredCompanies?: { name: string; status: string }[];
  finalState: string;
  behavior?: Expectations["behavior"];
  traceId?: string | null;
  error?: string;
}
