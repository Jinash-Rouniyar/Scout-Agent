"use client";

import { use } from "react";
import Link from "next/link";
import { useRun } from "@/lib/client/useRun";
import { Badge, Button, Card, CardTitle, ScoreDial } from "@/components/ui";

const PLAN_STEPS: { state: string; label: string }[] = [
  { state: "RESOLVING_IDENTITY", label: "Resolve identity" },
  { state: "RESEARCHING", label: "Research evidence" },
  { state: "VALIDATING", label: "Validate grounding" },
  { state: "READY_FOR_REVIEW", label: "Form conviction" },
  { state: "CREATING_DILIGENCE_PACK", label: "Create diligence pack" },
  { state: "WATCHING", label: "Watch for signals" },
];

const ORDER = ["CREATED", "RESOLVING_IDENTITY", "RESEARCHING", "VALIDATING", "READY_FOR_REVIEW", "CREATING_DILIGENCE_PACK", "WATCHING", "COMPLETED"];

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { snapshot, connected, error, confirm, approve } = useRun(id);

  if (error) return <p className="text-bad">{error}</p>;
  if (!snapshot) return <p className="text-muted">Loading run…</p>;

  const { run, entity, candidates, claims, dossier, sources, receipts } = snapshot;
  const stateIdx = ORDER.indexOf(run.state);
  const awaitingConfirm = run.state === "RESOLVING_IDENTITY" && !run.entityId && candidates.length > 0;
  const facts = claims.filter((c) => c.category === "fact");
  const interpretations = claims.filter((c) => c.category === "interpretation");
  const risks = claims.filter((c) => c.category === "risk");
  const openQs = claims.filter((c) => c.category === "open_question");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Scout run</div>
          <h1 className="text-xl font-semibold">{entity?.canonicalName ?? run.input}</h1>
          {run.thesis ? <p className="mt-1 text-sm text-muted">Lens: {run.thesis}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={connected ? "good" : "warn"}>{connected ? "live" : "polling"}</Badge>
          <Badge tone="accent">{run.state}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: plan + evidence */}
        <div className="col-span-1 space-y-6">
          <Card>
            <CardTitle>Research plan</CardTitle>
            <ul className="space-y-2 text-sm">
              {PLAN_STEPS.map((s) => {
                const idx = ORDER.indexOf(s.state);
                const done = stateIdx > idx;
                const active = run.state === s.state;
                return (
                  <li key={s.state} className="flex items-center gap-2">
                    <span className={done ? "text-good" : active ? "text-accent" : "text-muted"}>
                      {done ? "✓" : active ? "●" : "○"}
                    </span>
                    <span className={active ? "text-text" : "text-muted"}>{s.label}</span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardTitle>Evidence ({sources.length})</CardTitle>
            <div className="space-y-2 text-xs">
              {sources.length === 0 ? <p className="text-muted">No sources yet.</p> : null}
              {sources.map((s) => (
                <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="block truncate rounded border border-border bg-panel2 px-2 py-1 hover:border-accent">
                  <span className="mr-2 text-muted">[{s.tier}]</span>
                  {s.title ?? s.url}
                </a>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle>Budget</CardTitle>
            <div className="flex gap-4 text-sm">
              <div>
                <div className="text-2xl font-semibold tabular-nums">{run.toolCallCount}</div>
                <div className="text-xs text-muted">tool calls / 10</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">{run.docFetchCount}</div>
                <div className="text-xs text-muted">docs / 12</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: identity / dossier */}
        <div className="col-span-2 space-y-6">
          {awaitingConfirm ? (
            <Card>
              <CardTitle>Confirm identity</CardTitle>
              <p className="mb-3 text-sm text-muted">
                The match is ambiguous — Scout will not silently link a GitHub account. Choose the right
                person.
              </p>
              <div className="space-y-2">
                {candidates.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-border bg-panel2 p-3">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted">
                        {c.githubLogin ? `@${c.githubLogin} · ` : ""}
                        {c.companyDomain ?? ""} · confidence {c.confidence.toFixed(2)}
                      </div>
                      {c.summary ? <div className="mt-1 text-xs text-muted line-clamp-2">{c.summary}</div> : null}
                    </div>
                    <Button variant="ghost" onClick={() => confirm(c.id)}>
                      Select
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {run.state === "REVIEW_NEEDED" ? (
            <Card>
              <CardTitle>Review needed</CardTitle>
              <p className="text-sm text-warn">
                {run.error ?? "Research could not complete cleanly. You can re-run to continue."}
              </p>
            </Card>
          ) : null}

          {dossier ? (
            <>
              <Card>
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <CardTitle>Conviction</CardTitle>
                    <Badge tone={dossier.opportunityScore! >= 80 ? "good" : dossier.opportunityScore! >= 45 ? "warn" : "neutral"}>
                      {dossier.label}
                    </Badge>
                  </div>
                  <div className="flex gap-3">
                    <ScoreDial label="Opportunity" value={dossier.opportunityScore ?? 0} />
                    <ScoreDial label="Confidence" value={dossier.confidenceScore ?? 0} />
                  </div>
                </div>
                <h4 className="text-sm font-semibold text-text">Why now</h4>
                <p className="mt-1 text-sm text-muted">{dossier.whyNow}</p>
                <p className="mt-3 text-sm text-muted">{dossier.summary}</p>
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <ClaimList title="Facts" tone="good" items={facts.map((c) => c.text)} />
                <ClaimList title="Interpretations" tone="accent" items={interpretations.map((c) => c.text)} />
                <ClaimList title="Risks" tone="bad" items={risks.map((c) => c.text)} />
                <ClaimList title="Open questions" tone="warn" items={openQs.map((c) => c.text)} />
              </div>

              {run.state === "READY_FOR_REVIEW" ? (
                <Card>
                  <CardTitle>Diligence pack</CardTitle>
                  <p className="mb-3 text-sm text-muted">
                    Approve to create the Notion founder page, Google Doc memo, and Slack thread, and begin
                    watching for signals. All writes are idempotent with receipts.
                  </p>
                  <Button onClick={approve}>Approve &amp; create diligence pack</Button>
                </Card>
              ) : null}

              {receipts.length ? (
                <Card>
                  <CardTitle>Action receipts</CardTitle>
                  <div className="space-y-1 text-xs">
                    {receipts.map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded border border-border bg-panel2 px-2 py-1">
                        <span>
                          {r.targetApp} · {r.actionType}
                        </span>
                        <span className="flex items-center gap-2">
                          {r.externalObjectId ? <span className="text-muted">{r.externalObjectId.slice(0, 22)}</span> : null}
                          <Badge tone={r.result === "success" ? "good" : r.result === "failed" ? "bad" : "warn"}>{r.result}</Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}

              {["WATCHING", "COMPLETED"].includes(run.state) ? (
                <Link href="/watchlist" className="text-sm text-accent hover:underline">
                  View in watchlist →
                </Link>
              ) : null}
            </>
          ) : (
            <Card>
              <CardTitle>Live research</CardTitle>
              <p className="text-sm text-muted">Scout is working. Evidence and conviction will appear here.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ClaimList({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" | "warn" | "accent" }) {
  return (
    <Card>
      <CardTitle>
        <span className="inline-flex items-center gap-2">
          <Badge tone={tone}>{items.length}</Badge> {title}
        </span>
      </CardTitle>
      {items.length === 0 ? (
        <p className="text-xs text-muted">None recorded.</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-muted">
          {items.map((t, i) => (
            <li key={i} className="leading-snug">
              • {t}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
