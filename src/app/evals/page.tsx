import { readFile } from "node:fs/promises";
import path from "node:path";
import { Badge, Card, CardTitle, Eyebrow, PageTitle } from "@/components/ui";
import { EMPTY_REPORT, type EvalReport } from "../../../evals/report-types";

export const dynamic = "force-dynamic";

/** Reads the real evaluation report produced by `npm run eval`. Never fabricates
 *  metrics: if no run exists, it says so. */
async function loadReport(): Promise<EvalReport> {
  try {
    const raw = await readFile(path.join(process.cwd(), "evals", "report.json"), "utf8");
    return JSON.parse(raw) as EvalReport;
  } catch {
    return EMPTY_REPORT;
  }
}

export default async function EvalsPage() {
  const report = await loadReport();
  const hasRun = Boolean(report.generatedAt) && report.scenarios.length > 0;
  const m = report.metrics;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <Eyebrow>Quality assurance</Eyebrow>
        <PageTitle
          sub="Hard gates on the real agent: grounded facts, no unauthorized writes, no duplicate writes, material vs noise, Pass³ (all 3 trials pass). Connectors are mocked; Claude runs for real. This page only displays evals/report.json — it never invents a score."
        >
          Scout Reliability Suite
        </PageTitle>
      </section>

      {!hasRun ? (
        <Card>
          <CardTitle>No evaluation run yet</CardTitle>
          <p className="text-sm leading-relaxed text-slate-600">
            This is the reliability brief for the agent, not a live diligence view. The suite is 12 fixture
            scenarios × 3 trials (36 trajectories). Until you run it, there are no measured numbers to show —
            zeros here would look like a failed eval, so they are hidden on purpose.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            From the repo: <code className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">npm run eval</code>
          </p>
        </Card>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            {report.totalTrajectories} trajectories · {report.scenariosPassed} passed · {report.scenariosPartial}{" "}
            partial · {report.model} · {new Date(report.generatedAt!).toLocaleString()}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metric
              label="Grounded factual claims"
              value={`${m.groundedFactualClaimsPct}%`}
              tone={m.groundedFactualClaimsPct >= 100 ? "good" : "warn"}
            />
            <Metric
              label="Unauthorized writes"
              value={String(m.unauthorizedWrites)}
              tone={m.unauthorizedWrites === 0 ? "good" : "bad"}
            />
            <Metric
              label="Duplicate writes"
              value={String(m.duplicateWrites)}
              tone={m.duplicateWrites === 0 ? "good" : "bad"}
            />
            <Metric
              label="Material signals"
              value={`${m.materialSignalsDetected}/${m.materialSignalsExpected}`}
              tone="accent"
            />
            <Metric label="Noise alerts" value={String(m.noiseAlerts)} tone={m.noiseAlerts === 0 ? "good" : "warn"} />
            <Metric
              label="Pass³ reliability"
              value={`${m.passCubedPct}%`}
              tone={m.passCubedPct >= 100 ? "good" : "warn"}
            />
          </div>

          <Card>
            <CardTitle>Scenarios (Pass³ = all 3 trials pass)</CardTitle>
            <div className="space-y-3 text-sm">
              {report.scenarios.map((s) => (
                <div key={s.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-900">{s.id}</span>{" "}
                      <span className="text-xs text-slate-500">{s.family}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">
                        {s.passes}/{s.trials}
                      </Badge>
                      <Badge tone={s.passCubed ? "good" : "bad"}>{s.passCubed ? "Pass³" : "Fail"}</Badge>
                    </div>
                  </div>
                  {s.hardGateFailures.length ? (
                    <div className="mt-2 text-xs text-rose-600">
                      Hard gate: {s.hardGateFailures.join("; ")}
                    </div>
                  ) : null}
                  {s.traceUrls.some(Boolean) ? (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {s.traceUrls.map((u, i) =>
                        u ? (
                          <a
                            key={i}
                            href={u}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-slate-900 underline-offset-4 hover:underline"
                          >
                            Trace {i + 1}
                          </a>
                        ) : null,
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "warn" | "accent";
}) {
  return (
    <Card>
      <div className="text-[0.72rem] font-medium uppercase tracking-eyebrow text-slate-400">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</span>
        <Badge tone={tone}>
          {tone === "good" ? "OK" : tone === "bad" ? "Check" : tone === "warn" ? "Review" : "Info"}
        </Badge>
      </div>
    </Card>
  );
}
