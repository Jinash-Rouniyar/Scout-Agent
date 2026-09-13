import { writeFile } from "node:fs/promises";
import path from "node:path";
import { SCENARIOS } from "./scenarios";
import { runTrial } from "./harness";
import { evaluateTrajectory, passCubed, type TrialEvaluation } from "./validators";
import { traceUrl } from "@/lib/observability/langfuse";
import { SCOUT_MODEL } from "@/lib/util/anthropic";
import type { EvalReport, EvalScenarioResult } from "./report-types";
import type { Trajectory } from "./types";

const TRIALS = 3;

/**
 * Run the full 12 x 3 evaluation suite. Connectors are mocked; Claude Sonnet 5
 * runs for real. Writes a REAL report to evals/report.json — never fabricated.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required to run the evaluation suite (the real pipeline persists state).");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required — evals run the real agent, only connectors are mocked.");
    process.exit(1);
  }

  const scenarioResults: EvalScenarioResult[] = [];
  let totalFacts = 0;
  let groundedFacts = 0;
  let unauthorizedWrites = 0;
  let duplicateWrites = 0;
  let materialDetected = 0;
  let materialExpected = 0;
  let noiseAlerts = 0;

  for (const scenario of SCENARIOS) {
    console.log(`\n▶ ${scenario.id} (${scenario.family})`);
    const evals: TrialEvaluation[] = [];
    const trajectories: Trajectory[] = [];
    const traceIds: (string | null)[] = [];

    for (let i = 0; i < TRIALS; i++) {
      let traj: Trajectory;
      try {
        traj = await runTrial(scenario);
      } catch (e) {
        traj = {
          toolCalls: [], storedSourceUrls: [], claims: [], validationOk: false,
          writes: [], finalState: "FAILED_TERMINAL", error: e instanceof Error ? e.message : "trial-error",
        };
      }
      trajectories.push(traj);
      traceIds.push(traj.traceId ?? null);
      const evaluation = evaluateTrajectory(traj, scenario.expect);
      evals.push(evaluation);
      console.log(`  trial ${i + 1}: ${evaluation.pass ? "PASS" : "FAIL"}${evaluation.hardGateFailures.length ? ` [hard: ${evaluation.hardGateFailures.join(", ")}]` : ""}${evaluation.rubricFailures.length ? ` [rubric: ${evaluation.rubricFailures.join(", ")}]` : ""}`);

      // Aggregate real metrics.
      for (const c of traj.claims) {
        if (c.category === "fact") {
          totalFacts++;
          if (c.grounded) groundedFacts++;
        }
      }
      if ((scenario.expect.action?.expectedWriteCount ?? -1) === 0) unauthorizedWrites += traj.writes.length;
      if (traj.duplicateWriteDetected) duplicateWrites++;
      if (scenario.family === "material_signal") {
        materialExpected += scenario.expect.materiality?.expectedMaterialCount ?? 0;
        materialDetected += (traj.signals ?? []).filter((s) => s.materiality >= 60).length;
      }
      if (scenario.family === "noise_suppression") {
        noiseAlerts += (traj.signals ?? []).filter((s) => s.materiality >= 60).length;
      }
    }

    const passes = evals.filter((e) => e.pass).length;
    const cubed = passCubed(evals);
    scenarioResults.push({
      id: scenario.id,
      family: scenario.family,
      description: scenario.description,
      trials: TRIALS,
      passes,
      passCubed: cubed,
      hardGateFailures: [...new Set(evals.flatMap((e) => e.hardGateFailures))],
      rubricFailures: [...new Set(evals.flatMap((e) => e.rubricFailures))],
      traceIds,
      traceUrls: traceIds.map((t) => traceUrl(t)),
    });
  }

  const scenariosPassed = scenarioResults.filter((s) => s.passCubed).length;
  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    model: SCOUT_MODEL,
    scenarioCount: SCENARIOS.length,
    trialsPerScenario: TRIALS,
    totalTrajectories: SCENARIOS.length * TRIALS,
    scenariosPassed,
    scenariosPartial: scenarioResults.filter((s) => !s.passCubed && s.passes > 0).length,
    metrics: {
      groundedFactualClaimsPct: totalFacts === 0 ? 100 : Math.round((groundedFacts / totalFacts) * 100),
      unauthorizedWrites,
      duplicateWrites,
      materialSignalsDetected: materialDetected,
      materialSignalsExpected: materialExpected,
      noiseAlerts,
      passCubedPct: Math.round((scenariosPassed / SCENARIOS.length) * 100),
    },
    scenarios: scenarioResults,
  };

  const out = path.join(process.cwd(), "evals", "report.json");
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`\n✅ Wrote ${out}`);
  console.log(`Pass³: ${scenariosPassed}/${SCENARIOS.length} scenarios | grounded facts ${report.metrics.groundedFactualClaimsPct}% | unauthorized ${unauthorizedWrites} | duplicate ${duplicateWrites}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
