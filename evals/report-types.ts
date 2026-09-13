export interface EvalScenarioResult {
  id: string;
  title?: string;
  family: string;
  description: string;
  trials: number;
  passes: number;
  passCubed: boolean;
  hardGateFailures: string[];
  rubricFailures: string[];
  traceIds: (string | null)[];
  traceUrls: (string | null)[];
}

export interface EvalReport {
  generatedAt: string | null;
  model: string;
  scenarioCount: number;
  trialsPerScenario: number;
  totalTrajectories: number;
  scenariosPassed: number;
  scenariosPartial: number;
  metrics: {
    groundedFactualClaimsPct: number;
    unauthorizedWrites: number;
    duplicateWrites: number;
    materialSignalsDetected: number;
    materialSignalsExpected: number;
    noiseAlerts: number;
    passCubedPct: number;
  };
  scenarios: EvalScenarioResult[];
}

export const EMPTY_REPORT: EvalReport = {
  generatedAt: null,
  model: "claude-sonnet-5",
  scenarioCount: 0,
  trialsPerScenario: 3,
  totalTrajectories: 0,
  scenariosPassed: 0,
  scenariosPartial: 0,
  metrics: {
    groundedFactualClaimsPct: 0,
    unauthorizedWrites: 0,
    duplicateWrites: 0,
    materialSignalsDetected: 0,
    materialSignalsExpected: 0,
    noiseAlerts: 0,
    passCubedPct: 0,
  },
  scenarios: [],
};
