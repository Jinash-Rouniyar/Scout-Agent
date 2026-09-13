"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRun, type CompanySelection } from "@/lib/client/useRun";
import type { CompanyView, RunSnapshot } from "@/lib/core/snapshot";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Eyebrow,
  Input,
  InsetPanel,
  ScoreDial,
  Spinner,
  StatusDot,
} from "@/components/ui";

type RecapFn = (to?: string) => Promise<{
  ok: boolean;
  period?: string;
  emailResult?: string;
  error?: string;
  materialCount?: number;
}>;

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { snapshot, error, select, triggerRecap } = useRun(id);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!snapshot) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <Spinner />
        Loading run…
      </div>
    );
  }

  const { run } = snapshot;
  const companies = snapshot.companies ?? [];
  const state = run.state;
  const isThesis = run.inputKind === "thesis" || companies.length > 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl space-y-2">
          <Eyebrow>{isThesis ? "Investment thesis" : "Scout run"}</Eyebrow>
          <h1 className="text-xl font-semibold leading-snug tracking-tight text-slate-900 md:text-2xl">
            {isThesis ? (run.thesis ?? run.input) : (snapshot.entity?.canonicalName ?? run.input)}
          </h1>
        </div>
        <Badge tone="accent">{state.replaceAll("_", " ")}</Badge>
      </header>

      {(state === "CREATED" || state === "DISCOVERING") && (
        <DiscoveringPanel events={snapshot.events} />
      )}

      {(state === "REVIEW_NEEDED" || state === "FAILED_RETRYABLE") && (
        <Card>
          <CardTitle>Something needs attention</CardTitle>
          <p className="text-sm text-amber-700">
            {run.error ?? "Discovery could not complete cleanly. Refresh to retry."}
          </p>
        </Card>
      )}

      {state === "AWAITING_SELECTION" && companies.length > 0 && (
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <PlanRail state={state} companies={companies} />
          <SelectionPanel companies={companies} onSubmit={select} />
        </div>
      )}

      {(state === "RESEARCHING" || state === "CREATING_DILIGENCE_PACK") && (
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <PlanRail state={state} companies={companies} />
          <ResearchingPanel companies={companies} />
        </div>
      )}

      {isThesis && (state === "COMPLETED" || state === "WATCHING") && (
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <PlanRail state={state} companies={companies} />
          <ResultsPanel companies={companies} triggerRecap={triggerRecap} />
        </div>
      )}

      {!isThesis && snapshot.dossier && (
        <LegacyResultsPanel snapshot={snapshot} triggerRecap={triggerRecap} />
      )}
    </div>
  );
}

/* ---------------- Plan rail ---------------- */

const PLAN = [
  { id: "discover", label: "Discover companies", active: ["CREATED", "DISCOVERING"] },
  { id: "select", label: "Select & configure", active: ["AWAITING_SELECTION"] },
  { id: "research", label: "Research in parallel", active: ["RESEARCHING", "CREATING_DILIGENCE_PACK"] },
  { id: "done", label: "Diligence packs ready", active: ["COMPLETED", "WATCHING"] },
] as const;

function PlanRail({ state, companies }: { state: string; companies: CompanyView[] }) {
  const activeIdx = PLAN.findIndex((s) => (s.active as readonly string[]).includes(state));
  const selected = companies.filter((c) => c.selected);
  return (
    <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
      <Card>
        <CardTitle>Research plan</CardTitle>
        <ol className="space-y-3 text-sm">
          {PLAN.map((step, i) => {
            const active = (step.active as readonly string[]).includes(state);
            const done =
              activeIdx > i ||
              (active && step.id === "done") ||
              (activeIdx === -1 && (state === "COMPLETED" || state === "WATCHING"));
            const waiting = active && step.id === "select";
            const working = active && !done && !waiting;
            return (
              <li key={step.id} className="flex items-center gap-2.5">
                {working ? (
                  <Spinner className="h-3.5 w-3.5 shrink-0" />
                ) : waiting ? (
                  <PauseMark />
                ) : (
                  <span className={done ? "text-emerald-600" : "text-slate-300"}>{done ? "✓" : "○"}</span>
                )}
                <span className={active || waiting ? "font-medium text-slate-900" : done ? "text-slate-600" : "text-slate-400"}>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      {selected.length > 0 && (state === "RESEARCHING" || state === "CREATING_DILIGENCE_PACK") ? (
        <Card>
          <CardTitle>Companies</CardTitle>
          <ul className="space-y-2.5 text-sm">
            {selected.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-700">{c.name}</span>
                <CompanyStatusBadge status={c.status} compact />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </aside>
  );
}

/* ---------------- Discovery ---------------- */

function DiscoveringPanel({ events }: { events: RunSnapshot["events"] }) {
  const lastTool = [...events].reverse().find((e) => e.type === "discovery.tool");
  const toolName =
    lastTool && lastTool.payload && typeof lastTool.payload === "object" && "name" in lastTool.payload
      ? String((lastTool.payload as { name?: string }).name ?? "").replaceAll("_", " ")
      : null;
  return (
    <Card shadow="lg">
      <CardTitle>Discovering companies</CardTitle>
      <div className="flex items-start gap-3">
        <Spinner className="mt-0.5" />
        <div>
          <p className="text-sm text-slate-700">Scanning the market for companies that match your thesis.</p>
          <p className="mt-1 text-xs text-slate-500">
            {toolName ? `Now: ${toolName}` : "This usually takes 20–60 seconds."}
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Selection ---------------- */

interface SelState {
  selected: boolean;
  slack: boolean;
  email: boolean;
  notion: boolean;
}

function SelectionPanel({
  companies,
  onSubmit,
}: {
  companies: CompanyView[];
  onSubmit: (s: CompanySelection[]) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<Record<string, SelState>>(() =>
    Object.fromEntries(
      companies.map((c) => [
        c.id,
        { selected: !!c.selected, slack: c.optSlack !== false, email: c.optEmail !== false, notion: c.optNotion !== false },
      ]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const selectedCount = Object.values(rows).filter((r) => r.selected).length;
  const update = (id: string, patch: Partial<SelState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  async function submit() {
    const selections: CompanySelection[] = companies
      .filter((c) => rows[c.id]?.selected)
      .map((c) => ({ companyId: c.id, slack: rows[c.id].slack, email: rows[c.id].email, notion: rows[c.id].notion }));
    if (selections.length === 0) return;
    setSubmitting(true);
    await onSubmit(selections);
  }

  return (
    <div className="space-y-5">
      <div>
        <Eyebrow>{companies.length} companies found</Eyebrow>
        <p className="mt-1 text-sm text-slate-600">
          Select companies and choose delivery. Tip: 1–3 keeps diligence fast.
        </p>
      </div>
      <div className="space-y-3">
        {companies.map((c) => {
          const r = rows[c.id];
          return (
            <Card key={c.id} className={r?.selected ? "ring-1 ring-slate-900/10" : "opacity-70"}>
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  onClick={() => update(c.id, { selected: !r?.selected })}
                  aria-label="Toggle selection"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                    r?.selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-transparent hover:border-slate-400"
                  }`}
                >
                  <CheckIcon />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold tracking-tight text-slate-900">{c.name}</h3>
                    <SourceLink href={c.domain ? `https://${c.domain}` : null} label={c.domain} />
                    <SourceLink
                      href={c.githubOrg ? `https://github.com/${c.githubOrg}` : null}
                      label={c.githubOrg ? `@${c.githubOrg}` : null}
                    />
                  </div>
                  {c.oneLiner ? <p className="mt-1 text-sm text-slate-700">{c.oneLiner}</p> : null}
                  {c.whyMatch ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                      <span className="font-medium text-slate-600">Why it fits:</span> {c.whyMatch}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Toggle label="Slack monitor" on={!!r?.slack} disabled={!r?.selected} onClick={() => update(c.id, { slack: !r?.slack })} />
                    <Toggle label="Newsletter" on={!!r?.email} disabled={!r?.selected} onClick={() => update(c.id, { email: !r?.email })} />
                    <Toggle label="Notion record" on={!!r?.notion} disabled={!r?.selected} onClick={() => update(c.id, { notion: !r?.notion })} />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{selectedCount} selected</p>
        <Button onClick={submit} disabled={submitting || selectedCount === 0}>
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" />
              Starting…
            </span>
          ) : (
            `Create diligence pack (${selectedCount})`
          )}
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
        on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-slate-300"}`} />
      {label}
    </button>
  );
}

/* ---------------- Researching ---------------- */

function ResearchingPanel({ companies }: { companies: CompanyView[] }) {
  const selected = companies.filter((c) => c.selected);
  return (
    <div className="space-y-4">
      <div>
        <Eyebrow>Running diligence in parallel</Eyebrow>
        <p className="mt-1 text-sm text-slate-600">
          Each card fills as evidence lands — sources first, then scores and the memo.
        </p>
      </div>
      <div className="space-y-4">
        {selected.map((c) => (
          <CompanyCard key={c.id} company={c} defaultOpen={false} />
        ))}
      </div>
    </div>
  );
}

function CompanyStatusBadge({ status, compact }: { status: string; compact?: boolean }) {
  if (status === "ready")
    return (
      <Badge tone="good">
        <StatusDot tone="good" />
        {compact ? "Ready" : "Ready"}
      </Badge>
    );
  if (status === "failed") return <Badge tone="bad">Failed</Badge>;
  if (status === "researching")
    return (
      <Badge tone="warn">
        <Spinner className="h-3 w-3 border-amber-200 border-t-amber-700" />
        {compact ? "Live" : "Researching"}
      </Badge>
    );
  return (
    <Badge tone="neutral">
      <Spinner className="h-3 w-3" />
      Queued
    </Badge>
  );
}

/* ---------------- Results ---------------- */

function ResultsPanel({ companies, triggerRecap }: { companies: CompanyView[]; triggerRecap: RecapFn }) {
  const ready = companies.filter((c) => c.selected && c.status === "ready");
  const failed = companies.filter((c) => c.selected && c.status === "failed");
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Diligence complete</Eyebrow>
        <p className="mt-1 text-sm text-slate-600">
          {ready.length} {ready.length === 1 ? "pack" : "packs"} created.{" "}
          <Link href="/watchlist" className="font-medium text-slate-900 underline-offset-4 hover:underline">
            View watchlist →
          </Link>
        </p>
      </div>
      <div className="space-y-4">
        {ready.map((c) => (
          <CompanyCard key={c.id} company={c} defaultOpen={false} />
        ))}
        {failed.map((c) => (
          <CompanyCard key={c.id} company={c} defaultOpen={false} />
        ))}
      </div>
      <DevRecapTrigger triggerRecap={triggerRecap} />
    </div>
  );
}

function LegacyResultsPanel({ snapshot, triggerRecap }: { snapshot: RunSnapshot; triggerRecap: RecapFn }) {
  const { run, entity, dossier, claims, receipts, watch, sources } = snapshot;
  const docReceipt = receipts.find((r) => r.targetApp === "google_docs" && r.result === "success");
  const docUrl = docReceipt?.externalObjectId
    ? `https://docs.google.com/document/d/${docReceipt.externalObjectId}/edit`
    : (watch?.docUrl ?? null);
  const company = {
    id: entity?.id ?? run.id,
    name: entity?.canonicalName ?? run.input,
    domain: entity?.companyDomain ?? null,
    githubOrg: entity?.companyGithubOrg ?? null,
    selected: true,
    optSlack: true,
    optEmail: !!watch?.weeklyEmail,
    optNotion: true,
    status: "ready",
    opportunityScore: dossier?.opportunityScore ?? null,
    confidenceScore: dossier?.confidenceScore ?? null,
    label: dossier?.label ?? null,
    whyNow: dossier?.whyNow ?? null,
    docUrl,
    notionPageId: watch?.notionPageId ?? receipts.find((r) => r.targetApp === "notion")?.externalObjectId ?? null,
    slackThreadTs: watch?.slackThreadTs ?? receipts.find((r) => r.targetApp === "slack")?.externalObjectId ?? null,
    error: null,
    dossier,
    claims,
    sources: sources.filter((s) => !entity || s.entityId === entity.id),
    watch,
  } as CompanyView;
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Earlier single-entity run. Start a{" "}
        <Link href="/" className="font-medium text-slate-900 underline-offset-4 hover:underline">
          new thesis run
        </Link>{" "}
        to discover a shortlist.
      </p>
      <CompanyCard company={company} defaultOpen={false} />
      <DevRecapTrigger triggerRecap={triggerRecap} />
    </div>
  );
}

function CompanyCard({ company, defaultOpen }: { company: CompanyView; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = { fact: [], interpretation: [], risk: [], open_question: [] };
    for (const cl of company.claims ?? []) (g[cl.category] ??= []).push(cl.text);
    return g;
  }, [company.claims]);

  const op = company.opportunityScore ?? company.dossier?.opportunityScore ?? null;
  const conf = company.confidenceScore ?? company.dossier?.confidenceScore ?? null;
  const label = company.label ?? company.dossier?.label ?? "";
  const whyNow = company.whyNow ?? company.dossier?.whyNow ?? "";
  const sources = company.sources ?? [];
  const working = company.status === "pending" || company.status === "researching";
  const failed = company.status === "failed";
  const ready = company.status === "ready";
  const phase =
    company.status === "ready"
      ? "Pack ready"
      : company.status === "failed"
        ? company.error ?? "Research failed"
        : op != null
          ? "Writing diligence pack…"
          : sources.length
            ? "Forming conviction…"
            : company.status === "researching"
              ? "Gathering sources…"
              : "Waiting to start…";

  return (
    <Card shadow="lg" className={working ? "ring-1 ring-slate-900/5" : undefined}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">{company.name}</h3>
            {label ? <Badge tone={op != null && op >= 65 ? "good" : op != null && op >= 45 ? "warn" : "neutral"}>{label}</Badge> : null}
            <CompanyStatusBadge status={company.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SourceLink href={company.domain ? `https://${company.domain}` : null} label={company.domain} />
            <SourceLink
              href={company.githubOrg ? `https://github.com/${company.githubOrg}` : null}
              label={company.githubOrg ? `@${company.githubOrg}` : null}
            />
          </div>
          {working ? (
            <p className="inline-flex items-center gap-2 text-xs text-slate-500">
              <Spinner className="h-3 w-3" />
              {phase}
            </p>
          ) : null}
        </div>
        {op != null && conf != null ? (
          <div className="flex gap-3">
            <ScoreDial label="Opportunity" value={op} />
            <ScoreDial label="Confidence" value={conf} />
          </div>
        ) : working ? (
          <div className="flex gap-3">
            <ScoreSkeleton label="Opportunity" />
            <ScoreSkeleton label="Confidence" />
          </div>
        ) : null}
      </div>

      {failed ? <p className="mt-4 text-sm text-rose-600">{company.error ?? "Research could not complete."}</p> : null}

      {sources.length > 0 ? (
        <div className="mt-5">
          <h4 className="text-[0.72rem] font-medium uppercase tracking-eyebrow text-slate-400">Evidence</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {sources.slice(0, 8).map((s) => (
              <SourceLink key={s.id} href={s.url} label={s.title ?? s.url} />
            ))}
          </div>
        </div>
      ) : working ? (
        <div className="mt-5 h-8 animate-pulse rounded-xl bg-slate-100" />
      ) : null}

      {whyNow ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-5 w-full text-left">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-[0.72rem] font-medium uppercase tracking-eyebrow text-slate-400">Why now</h4>
            <span className="text-xs font-medium text-slate-500">{open ? "Hide details" : "Show details"}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{whyNow}</p>
        </button>
      ) : working ? (
        <div className="mt-5 space-y-2">
          <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : null}

      {open && ready ? (
        <div className="mt-5 space-y-5 border-t border-slate-200 pt-5">
          {company.docUrl ? (
            <a
              href={company.docUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black"
            >
              <Favicon url={company.docUrl} />
              View full report
            </a>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <ClaimList title="Facts" items={grouped.fact} />
            <ClaimList title="Interpretations" items={grouped.interpretation} />
            <ClaimList title="Risks" items={grouped.risk} />
            <ClaimList title="Open questions" items={grouped.open_question} />
          </div>
          <DeliveryStatus company={company} />
        </div>
      ) : ready ? (
        <DeliveryStatus company={company} />
      ) : null}
    </Card>
  );
}

function ScoreSkeleton({ label }: { label: string }) {
  return (
    <div className="min-w-[7rem] rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[0.65rem] font-medium uppercase tracking-eyebrow text-slate-400">{label}</div>
      <div className="mt-2 h-8 w-10 animate-pulse rounded bg-slate-200" />
    </div>
  );
}

function DeliveryStatus({ company }: { company: CompanyView }) {
  const items: { label: string; on: boolean; done: boolean }[] = [
    { label: "Newsletter", on: company.optEmail, done: !!company.watch?.weeklyEmail },
    { label: "Slack monitoring", on: company.optSlack, done: !!company.slackThreadTs },
    { label: "Notion record", on: company.optNotion, done: !!company.notionPageId },
  ];
  const active = items.filter((i) => i.on);
  if (active.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
      {active.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <StatusDot tone={i.done ? "good" : "warn"} />
          {i.label} {i.done ? "on" : "pending"}
        </span>
      ))}
    </div>
  );
}

function ClaimList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h5 className="text-[0.72rem] font-medium uppercase tracking-eyebrow text-slate-400">
        {title} <span className="text-slate-300">({items.length})</span>
      </h5>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-slate-400">None recorded.</p>
      ) : (
        <ul className="mt-1.5 space-y-2 text-sm leading-relaxed text-slate-600">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DevRecapTrigger({ triggerRecap }: { triggerRecap: RecapFn }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!email.trim()) {
      setState("error");
      setMsg("Enter the email that should receive this recap.");
      return;
    }
    setState("sending");
    setMsg(null);
    const res = await triggerRecap(email.trim());
    if (res.ok) {
      setState("done");
      setMsg(`Sent to ${email.trim()} for ${res.period} (${res.materialCount ?? 0} material signals).`);
    } else {
      setState("error");
      setMsg(res.error ?? "Send failed.");
    }
  }

  return (
    <Card className="border-dashed">
      <CardTitle>Dev trigger</CardTitle>
      <p className="mb-3 text-xs text-slate-500">
        Demo only — send the newsletter to any inbox so you can see how it lands. Not a production control.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@firm.com"
          className="sm:max-w-xs"
        />
        <Button variant="ghost" onClick={run} disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send newsletter"}
        </Button>
      </div>
      {msg ? (
        <div className="mt-3">
          <InsetPanel className={state === "error" ? "border-rose-200 text-rose-600" : "border-emerald-200 text-emerald-700"}>
            {msg}
          </InsetPanel>
        </div>
      ) : null}
    </Card>
  );
}

/* ---------------- Sources / favicons ---------------- */

function hostnameOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

function Favicon({ url }: { url: string }) {
  const host = hostnameOf(url);
  if (host === "github.com") {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-slate-700" aria-hidden fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
      </svg>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={14}
      height={14}
      className="h-3.5 w-3.5 shrink-0 rounded-sm"
    />
  );
}

function SourceLink({ href, label }: { href?: string | null; label?: string | null }) {
  if (!href || !label) return null;
  const text = label.length > 48 ? `${label.slice(0, 45)}…` : label;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[0.7rem] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
    >
      <Favicon url={href} />
      <span className="truncate">{text}</span>
    </a>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
      <path d="M5 10.5l3 3 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PauseMark() {
  return (
    <span
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-amber-600"
      title="Waiting for you"
      aria-label="Waiting for you"
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden fill="currentColor">
        <rect x="4" y="3" width="2.5" height="10" rx="0.6" />
        <rect x="9.5" y="3" width="2.5" height="10" rx="0.6" />
      </svg>
    </span>
  );
}
