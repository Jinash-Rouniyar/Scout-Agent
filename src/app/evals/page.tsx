import { readFile } from "node:fs/promises";
import path from "node:path";
import { Badge, Card, CardTitle } from "@/components/ui";
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
  const m = report.metrics;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Scout Reliability Suite</h1>
        <p className="mt-1 text-sm text-muted">
          {report.generatedAt
            ? `${report.totalTrajectories} trajectories · ${report.scenariosPassed} passed · ${report.scenariosPartial} partial · generated ${new Date(report.generatedAt).toLocaleString()}`
            : "No evaluation run yet. Run `npm run eval` (mocked connectors, real Claude Sonnet 5) to populate real results."}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Metric label="Grounded factual claims" value={`${m.groundedFactualClaimsPct}%`} tone={m.groundedFactualClaimsPct >= 100 ? "good" : "warn"} />
        <Metric label="Unauthorized writes" value={String(m.unauthorizedWrites)} tone={m.unauthorizedWrites === 0 ? "good" : "bad"} />
        <Metric label="Duplicate writes" value={String(m.duplicateWrites)} tone={m.duplicateWrites === 0 ? "good" : "bad"} />
        <Metric label="Material signals" value={`${m.materialSignalsDetected}/${m.materialSignalsExpected}`} tone="accent" />
        <Metric label="Noise alerts" value={String(m.noiseAlerts)} tone={m.noiseAlerts === 0 ? "good" : "warn"} />
        <Metric label="Pass³ reliability" value={`${m.passCubedPct}%`} tone={m.passCubedPct >= 100 ? "good" : "warn"} />
      </div>

      <Card>
        <CardTitle>Scenarios (Pass³ = all 3 trials pass)</CardTitle>
        {report.scenarios.length === 0 ? (
          <p className="text-sm text-muted">No scenarios recorded.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {report.scenarios.map((s) => (
              <div key={s.id} className="rounded-lg border border-border bg-panel2 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{s.id}</span>{" "}
                    <span className="text-xs text-muted">{s.family}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{s.passes}/{s.trials}</Badge>
                    <Badge tone={s.passCubed ? "good" : "bad"}>{s.passCubed ? "Pass³" : "fail"}</Badge>
                  </div>
                </div>
                {s.hardGateFailures.length ? (
                  <div className="mt-1 text-xs text-bad">Hard gate: {s.hardGateFailures.join("; ")}</div>
                ) : null}
                {s.traceUrls.some(Boolean) ? (
                  <div className="mt-1 flex gap-2 text-xs">
                    {s.traceUrls.map((u, i) => (u ? <a key={i} href={u} target="_blank" rel="noreferrer" className="text-accent hover:underline">trace {i + 1}</a> : null))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "warn" | "accent" }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <Badge tone={tone}>{tone === "good" ? "ok" : tone === "bad" ? "check" : tone === "warn" ? "review" : "info"}</Badge>
      </div>
    </Card>
  );
}
