# Scout — Founder Discovery & Continuous Diligence

Scout is an entity-first investment-intelligence web app. You supply one person or company
(a name, GitHub URL, company website, or profile URL) plus an optional investment thesis, and
Scout deeply researches that entity with a bounded agent, produces an evidence-backed dossier,
creates an approved diligence pack across Notion + Google Docs + Slack, and then watches for
material signals — posting to Slack/Notion and sending a weekly Gmail recap.

This repo implements the design in [DESIGN.md](DESIGN.md).

## Stack

- Next.js (App Router) + TypeScript on Vercel
- Postgres (Neon) via Drizzle ORM
- Anthropic `claude-sonnet-5` for the bounded research agent
- Exa (people enrichment), GitHub (technical evidence), Tavily (web) behind a `SearchProvider`
- Notion / Google Docs / Slack / Gmail write connectors
- Langfuse for trace/score observability
- Vercel Cron for daily monitoring + the Friday recap

## Architecture

- `src/lib/db` — Drizzle schema + client. Uniqueness constraints enforce idempotency/dedupe.
- `src/lib/connectors` — live + fixture implementations behind shared interfaces.
- `src/lib/core` — state machine, resolver, bounded agent + tools, scoring, validation,
  receipts (idempotency authority), monitoring, materiality, cron lease, recap, pipeline.
- `src/lib/observability` — Langfuse wrapper + redaction (safe metadata only).
- `src/app` — UI (entity input, run/dossier, watchlist, evaluation console) + API routes + cron.
- `evals` — 12 deterministic scenarios × 3 trials, validators, Pass³, real report.

## Setup

1. Install: `npm install`
2. Copy env: `cp .env.example .env` and fill values (see connectors below). Only `DATABASE_URL`
   is required to boot; every other credential is validated lazily when used.
3. Push schema: `npm run db:push`
4. (Optional) Seed the cached demo trace: `npm run db:seed`
5. Dev: `npm run dev`

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests (scoring, validation, resolver, materiality, eval validators) |
| `npm run db:generate` / `db:push` | Drizzle migrations |
| `npm run db:seed` | Seed the demo run (Alice AI) |
| `npm run eval` | Run the 12×3 evaluation suite (mocked connectors, real Claude) and write `evals/report.json` |

## Connectors

Every connector has a live implementation and a fixture implementation (evals mock all
connectors; Anthropic always runs for real). Idempotency for all external writes is enforced by
the `action_receipts` table — not by any provider API.

| Connector | Env | Setup / scopes | Demo resource |
|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | API key. Model `claude-sonnet-5` (override with `ANTHROPIC_MODEL`). | — |
| Exa | `EXA_API_KEY` | API key. People enrichment for name inputs (no LinkedIn scraping). | Known public person |
| Tavily | `TAVILY_API_KEY` | API key (free tier). Degrades gracefully if unavailable. | — |
| GitHub | `GITHUB_TOKEN` (optional) | Public REST API; token raises rate limits. | Controlled repo with a post-baseline release |
| Notion | `NOTION_API_KEY`, `NOTION_DATABASE_ID` | Internal integration token; share one database with it; a page template. | Dedicated DB + template |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID` | Bot token with `chat:write`; invite the bot to the test channel. | Test workspace/channel |
| Google Docs + Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `RECAP_TO_EMAIL` | OAuth client; refresh token minted offline. Scopes: `.../auth/documents` + `.../auth/gmail.send`. | Google test account |
| Langfuse | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Project keys. | Connected project |
| Vercel Cron | `CRON_SECRET` | Sent as `Authorization: Bearer <CRON_SECRET>`. | — |
| Admin (demo) | `ADMIN_TOKEN` | Protects the manual weekly-recap trigger. | — |

### LinkedIn / profile URLs

A LinkedIn or other profile URL is **identity context only**. Scout never fetches or scrapes it;
Exa resolves professional data instead.

## Runtime model

- `POST /api/runs` creates a run. `GET /api/runs/:id/execute` runs the bounded research
  synchronously, persisting events/results and streaming SSE. There is no assumed background
  work: if the function budget is exceeded the run persists `REVIEW_NEEDED` and can be re-executed.
- `GET /api/runs/:id/events` is the reconnectable SSE stream (honors `Last-Event-ID`, replays
  missed persisted events). `GET /api/runs/:id` is the 3s polling fallback and hydration
  snapshot; the UI rebuilds entirely from persisted history after a refresh.

## Conviction model

Opportunity = `0.35·technical + 0.25·momentum + 0.20·thesisFit + 0.20·companyMarket`, minus a
verified-risk penalty (−5 per verified negative fact, capped at −15), clamped to [0,100]. Missing
information is never a penalty — it lowers confidence and becomes an open question. Confidence =
`0.40·sourceQuality + 0.30·corroboration + 0.20·recency + 0.10·entityResolutionCertainty`. The
model chooses fixed rubric bands (0/25/50/75/100) and explanations only; code owns every number.

## Monitoring & cron

- `/api/cron/monitor` (`0 14 * * *`) and `/api/cron/recap` (`0 16 * * 5`) — see `vercel.json`.
- Each invocation validates `CRON_SECRET`, claims a self-expiring `cron_leases` row (safe with
  Neon/Vercel pooling — no session advisory locks), claims a persisted `cron_run` per UTC window,
  processes ≤10 entities (persisting each before the next), retries a failed entity ≤3 times then
  marks it terminal, and writes idempotently via receipts. Cron never re-runs deep diligence.
- The weekly recap is `runWeeklyRecap({ force, asOfDate })`; the Friday cron calls it normally and
  the demo-only `POST /api/admin/recap` invokes the same function manually (Vercel Cron only runs
  in production and does not retry). Both share one idempotency receipt, so they never double-send.
  The recap actually **sends** a Gmail email.

## Evaluation

`npm run eval` runs 12 scenarios × 3 trials = 36 trajectories with mocked connectors and the real
agent. It enforces hard gates (grounding, no unauthorized/duplicate writes, injection resistance),
scenario rubrics, and `Pass³`, then writes a real `evals/report.json` surfaced at `/evals` with
Langfuse trace links. Metrics are never fabricated.

See [docs/DEMO.md](docs/DEMO.md) for the connected demo environment checklist and the two-minute
walkthrough.
