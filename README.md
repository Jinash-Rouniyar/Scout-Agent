# Scout — Thesis-first founder discovery and continuous diligence

Scout starts from an **investment thesis**, finds 5–8 real companies that fit, and builds an evidence-backed diligence pack only for the ones you pick.

A thesis looks like:

> Pre-seed founders building developer infrastructure for AI agents, with meaningful open-source traction.

Scout then:

1. Discovers a shortlist (web + GitHub; never invented).
2. Lets you select companies and choose delivery: Slack monitoring, newsletter, Notion record.
3. Researches selected companies in parallel and scores opportunity + confidence.
4. Writes a **Google Doc** as the canonical report (headings, outline, facts / interpretations / questions).
5. Shows a brief on screen. Slack is a short alert + Doc link. Notion is a structured record — not three copies of the same memo.
6. Watches opted-in companies. Material signals (score ≥ 60) post to Slack/Notion.
7. Sends a weekly **Gmail newsletter** (hero + company marks + editorial brief). A demo trigger sends the same letter.

This repo implements [DESIGN.md](DESIGN.md). Demo checklist: [docs/DEMO.md](docs/DEMO.md).

## Stack

- Next.js 15 App Router + TypeScript on Vercel
- Postgres (Neon) via Drizzle ORM
- Anthropic Claude Sonnet for discovery and research
- Exa, GitHub, Tavily behind connector interfaces
- Notion / Google Docs / Slack / Gmail writes, idempotent via `action_receipts`
- Langfuse (US project: `https://us.cloud.langfuse.com`)
- Vercel Cron: daily monitor + Friday newsletter

## Product surfaces

| Route | Purpose |
|---|---|
| `/` | New thesis run |
| `/runs/[id]` | Discovery → select & configure → parallel research → briefs |
| `/runs/run_demo_thesis` | Seeded completed demo run |
| `/watchlist` | Watched companies and signal timeline |
| `/evals` | Reliability suite (reads real `evals/report.json` only) |

## Architecture

- `src/lib/db` — Drizzle schema. Uniqueness constraints enforce idempotency and dedupe.
- `src/lib/connectors` — live + fixture implementations.
- `src/lib/core` — discovery, pipeline, agent, scoring, receipts, monitoring, newsletter, diligence writer.
- `src/lib/observability` — Langfuse + redaction.
- `src/app` — UI, API, cron, server actions.
- `evals` — 12 scenarios × 3 trials, Pass³, never fabricated scores.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill values. Only `DATABASE_URL` is required to boot; other keys are validated when used.
3. `npm run db:push`
4. Optional demo seed: `npm run db:seed` (creates `run_demo_thesis`)
5. Google OAuth (Docs + Gmail): `npx tsx --env-file=.env scripts/google-oauth.ts`
6. `npm run dev` (port 3001 if 3000 is taken)

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest |
| `npm run db:generate` / `db:push` | Drizzle |
| `npm run db:seed` | Seed the thesis demo run |
| `npm run eval` | 12×3 reliability suite (mocked connectors, real Claude) → `evals/report.json` |

## Connectors

| Connector | Env | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Model `claude-sonnet-5` (override with `ANTHROPIC_MODEL`) |
| Exa | `EXA_API_KEY` | People/company enrichment; no LinkedIn scraping |
| Tavily | `TAVILY_API_KEY` | Web search; degrades if missing |
| GitHub | `GITHUB_TOKEN` | Optional; raises rate limits |
| Notion | `NOTION_API_KEY`, `NOTION_DATABASE_ID` | Structured diligence record |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID` | Short alert + monitor thread |
| Google Docs + Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `RECAP_TO_EMAIL` | Formatted memo + newsletter. Scopes: `documents` + `gmail.send` |
| Langfuse | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Must match project region (this project is US) |
| Cron / admin | `CRON_SECRET`, `ADMIN_TOKEN` | Cron auth + optional admin recap route |

A LinkedIn or profile URL is **identity context only**. Scout never fetches or scrapes it.

## Runtime

- `POST /api/runs` creates a thesis run and starts discovery.
- `POST /api/runs/:id/select` starts parallel diligence for selected companies.
- `GET /api/runs/:id` hydrates the UI. SSE (`/events`) and polling run only while the run is in progress.
- Research plan: Discover → Select & configure (pause) → Research → Diligence packs ready (check).

## Conviction

Opportunity = `0.35·technical + 0.25·momentum + 0.20·thesisFit + 0.20·companyMarket`, minus a verified-risk penalty (−5 per verified negative fact, capped at −15). Missing information is never a penalty — it lowers confidence and becomes an open question.

Confidence = `0.40·sourceQuality + 0.30·corroboration + 0.20·recency + 0.10·entityResolutionCertainty`. The model chooses rubric bands; code owns every number.

## Monitoring and newsletter

- `/api/cron/monitor` (`0 14 * * *`) and `/api/cron/recap` (`0 16 * * 5`) — see `vercel.json`.
- Cron validates `CRON_SECRET`, claims a lease + window, processes ≤10 entities, retries a failed entity ≤3 times, writes via receipts.
- The newsletter is `runWeeklyRecap({ to })`. Friday cron is idempotent per week. The run-page **Send newsletter** button always sends a fresh letter to the address you enter (hero image, company logos, editorial brief).

## Evaluation

`npm run eval` runs 36 trajectories with mocked connectors and the real agent. Hard gates: grounding, no unauthorized/duplicate writes, injection resistance, Pass³. `/evals` shows that report only — it never invents a passing score.
