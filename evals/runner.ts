import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SCENARIOS } from "./scenarios";
import { runTrial } from "./harness";
import { evaluateTrajectory, passCubed, type TrialEvaluation } from "./validators";
import { traceUrl } from "@/lib/observability/langfuse";
import { SCOUT_MODEL } from "@/lib/util/anthropic";
import type { EvalReport, EvalScenarioResult } from "./report-types";
import type { Trajectory } from "./types";

const TRIALS = 1;
const ONLY = (process.env.EVAL_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const QUEUE = ONLY.length ? SCENARIOS.filter((s) => ONLY.includes(s.id)) : SCENARIOS;

/**
 * Thesis-pipeline reliability suite. Connectors are mocked; Claude runs for
 * discovery and diligence. Writes a real report to evals/report.json.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required to run the evaluation suite.");
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

  if (ONLY.length && QUEUE.length === 0) {
    console.error(`EVAL_ONLY matched no scenarios: ${ONLY.join(", ")}`);
    process.exit(1);
  }

  for (const scenario of QUEUE) {
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
          toolCalls: [],
          storedSourceUrls: [],
          claims: [],
          validationOk: false,
          writes: [],
          finalState: "FAILED_TERMINAL",
          error: e instanceof Error ? e.message : "trial-error",
        };
      }
      trajectories.push(traj);
      traceIds.push(traj.traceId ?? null);
      const evaluation = evaluateTrajectory(traj, scenario.expect);
      evals.push(evaluation);
      console.log(
        `  trial ${i + 1}: ${evaluation.pass ? "PASS" : "FAIL"}${evaluation.hardGateFailures.length ? ` [hard: ${evaluation.hardGateFailures.join(", ")}]` : ""}${evaluation.rubricFailures.length ? ` [rubric: ${evaluation.rubricFailures.join(", ")}]` : ""}`,
      );

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
    scenarioResults.push({
      id: scenario.id,
      title: scenario.title,
      family: scenario.family,
      description: scenario.description,
      trials: TRIALS,
      passes,
      passCubed: passCubed(evals),
      hardGateFailures: [...new Set(evals.flatMap((e) => e.hardGateFailures))],
      rubricFailures: [...new Set(evals.flatMap((e) => e.rubricFailures))],
      traceIds,
      traceUrls: traceIds.map((t) => traceUrl(t)),
    });
  }

  const out = path.join(process.cwd(), "evals", "report.json");
  let merged = scenarioResults;
  let priorMetrics: EvalReport["metrics"] | null = null;
  if (ONLY.length) {
    try {
      const prior = JSON.parse(await readFile(out, "utf8")) as EvalReport;
      priorMetrics = prior.metrics;
      const byId = new Map(prior.scenarios.map((s) => [s.id, s]));
      for (const s of scenarioResults) byId.set(s.id, s);
      merged = SCENARIOS.map((sc) => byId.get(sc.id)).filter((s): s is EvalScenarioResult => Boolean(s));
    } catch {
      merged = scenarioResults;
    }
  }

  const scenariosPassed = merged.filter((s) => s.passCubed).length;
  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    model: SCOUT_MODEL,
    scenarioCount: merged.length,
    trialsPerScenario: TRIALS,
    totalTrajectories: merged.reduce((n, s) => n + s.trials, 0),
    scenariosPassed,
    scenariosPartial: merged.filter((s) => !s.passCubed && s.passes > 0).length,
    metrics: {
      groundedFactualClaimsPct:
        priorMetrics?.groundedFactualClaimsPct ??
        (totalFacts === 0 ? 100 : Math.round((groundedFacts / totalFacts) * 100)),
      unauthorizedWrites: priorMetrics?.unauthorizedWrites ?? unauthorizedWrites,
      duplicateWrites: priorMetrics?.duplicateWrites ?? duplicateWrites,
      materialSignalsDetected: priorMetrics?.materialSignalsDetected ?? materialDetected,
      materialSignalsExpected: priorMetrics?.materialSignalsExpected ?? materialExpected,
      noiseAlerts: priorMetrics?.noiseAlerts ?? noiseAlerts,
      passCubedPct: merged.length ? Math.round((scenariosPassed / merged.length) * 100) : 0,
    },
    scenarios: merged,
  };
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`\n✅ Wrote ${out}`);
  console.log(
    `Passed ${scenariosPassed}/${SCENARIOS.length} · grounded facts ${report.metrics.groundedFactualClaimsPct}% · unauthorized ${unauthorizedWrites} · duplicate ${duplicateWrites}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
