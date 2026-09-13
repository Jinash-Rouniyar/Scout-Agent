# Scout — Founder Discovery & Continuous Diligence

**Status:** Implemented — thesis-first demo ready  
**Date:** September 13, 2026  
**Audience:** Hackathon team, judges, prospective design partners

---

## Glossary

- **Thesis** — The investor's natural-language definition of the companies they want to discover.
- **Candidate** — A company returned by discovery that may merit diligence.
- **Diligence pack** — Per-company artifacts: on-screen brief, Google Doc memo, optional Slack / Notion / newsletter.
- **Claim** — A fact, interpretation, risk, or open question in a memo.
- **Evidence** — A source record used to support a claim; includes URL, retrieval time, source type, and extracted excerpt.
- **Signal** — A newly detected, deduplicated event that may change conviction about a watched company.
- **Conviction** — Scout's explicitly explained assessment of fit and momentum; never a fact.
- **Watch** — A subscription to selected public sources for a company.
- **Newsletter** — Weekly Gmail letter for opted-in companies (editorial brief, company marks, what moved). Distinct from Slack alerts.
- **Action receipt** — The durable record of an external write, including app, object ID, timestamp, request fingerprint, and outcome.

---

## 1. Executive Summary

### 1.1 What We Are Building

Scout is a web application for early-stage investors that starts from an **investment thesis**, surfaces a shortlist of matching companies, and builds evidence-backed diligence only for the ones the investor selects.

An investor provides a thesis such as:

> Find pre-seed founders building developer infrastructure for AI agents, with meaningful open-source traction.

Scout then:

1. Discovers 5–8 real companies that fit the thesis (web + GitHub; never invented).
2. Lets the investor select companies and choose delivery per company: Slack monitoring, newsletter, Notion record.
3. Researches selected companies in parallel and scores opportunity + confidence.
4. Writes a **Google Doc as the canonical full report** (Heading 1/2 so the outline lists sections). Slack is a short alert + link. Notion is a structured record — not three copies of the same memo.
5. Shows a brief on-screen overview (scores, why-now, expandable details). The full memo lives in the Doc.
6. Monitors opted-in companies; material signals post to Slack/Notion only when those options were selected.
7. Sends a weekly **Gmail newsletter** (hero, company logos, editorial brief, what moved). A demo trigger sends a fresh letter to any inbox.

Scout is not a general-purpose work agent, CRM, or LinkedIn scraper. It is a focused intelligence system for the question: **who should we know before everyone else does, and what evidence supports that view?**

### 1.2 Problem

Early-stage investors manually switch among people databases, GitHub, company websites, news, Notion, and Slack. This creates three failures:

- Discovery is broad, but conviction is shallow.
- Diligence is recreated from scratch for every meeting.
- Interesting people are not monitored consistently after an initial review.

Existing broad assistants can search and summarize, but do not create a durable, source-backed conviction record or a continuous signal loop tailored to investment sourcing.

### 1.3 Hackathon Scope

The demonstrable MVP is thesis-first company diligence:

- Thesis → 5–8 company shortlist → user selects companies + delivery options → parallel diligence packs.
- Google Doc is always the full report. Slack / newsletter / Notion are opt-in and non-duplicative.
- Real external writes to Notion, Google Docs, Slack, and Gmail.
- Daily monitoring only for companies the user chose to watch.
- Weekly Gmail newsletter with a manual demo trigger.

Out of scope for the MVP: outbound outreach, CRM replacement, LinkedIn scraping, team permissions, custom workflow builders, and broad browser automation.

---

## 2. Product Experience

### 2.1 Primary User

An early-stage investor or researcher who sources technical founders before a company has broad press coverage or a mature data-room footprint.

### 2.2 Primary Workflow

```text
Investment thesis
  → discover 5–8 matching companies
  → user selects companies + Slack / newsletter / Notion
  → parallel research + scored brief
  → Google Doc full report (always)
  → optional Slack alert, Notion record, newsletter watch
  → daily monitoring (opted-in surfaces only)
  → weekly investor newsletter (dev-triggerable)
```

### 2.3 Product Surfaces

Scout should be a web app. Slack and Notion are destinations for work, not the complete product surface.

| View | Purpose | Essential content |
|---|---|---|
| Thesis | Start a scouting run | Investment thesis |
| Shortlist | Pick companies | 5–8 names, why they fit, select + delivery toggles |
| Diligence results | Decide quickly | Scores, why-now, Doc link, delivery status |
| Watchlist | Monitor ongoing conviction | Signal timeline, View diligence pack |
| Evaluation | Reliability brief | Real `evals/report.json` only — never invented scores |
| Langfuse | Make the agent legible | Nested discovery / research / write steps |

### 2.4 UI Direction

The UI should resemble an investment-intelligence cockpit, not a generic chat window.

**Thesis screen**

```text
What are you looking to invest in?

[ Find pre-seed founders building developer infrastructure for AI agents… ]
                                                     [ Discover companies ]
```

**Shortlist**

```text
Lemma          Production monitoring for AI agents     [ ] select
               Slack  Newsletter  Notion

Orbital Agents Open-source agent runtime               [x] select
               Slack  Newsletter  Notion

                                          [ Create diligence pack (1) ]
```

**Results** — brief on screen; full memo is the Google Doc.

```text
Orbital Agents                         Opportunity 78   Confidence 68
Why now: …one paragraph…

[ Show details ]     Doc link · facts / risks / open questions

Newsletter · Slack monitoring · Notion record

[ Send newsletter ]   ← demo / developer
```

**Watchlist** groups changes by company. A major signal posts only to the surfaces the user opted into; minor activity stays in the app.

---

## 3. System Overview

### 3.1 Proposed Architecture

```text
Scout Web App ──SSE──> Scout Core / Vercel Functions
                         │
                         ├──> Read connectors: Exa · GitHub · public web
                         ├──> Write connectors: Notion · Google Docs · Slack · Gmail
                         ├──> Postgres: runs · sources · claims · receipts · watches
                         └──> Langfuse: traces · evals · cost · latency
```

### 3.2 Core Principle: One Agent, Many Tools

The MVP should not use a multi-agent swarm. It needs one **Scout Research Agent** with a constrained toolset, a durable outer workflow, and a bounded inner research loop.

```text
Deterministic workflow
  → bounded autonomous research
  → claim validation
  → user-approved external writes
```

This is agentic without allowing a model to make unbounded browser, shell, or communication decisions.

### 3.3 Run State Machine

Thesis-first flow (shipped):

```text
CREATED
  → DISCOVERING
  → AWAITING_SELECTION
  → RESEARCHING
  → CREATING_DILIGENCE_PACK
  → COMPLETED / WATCHING

Any state → FAILED_RETRYABLE | FAILED_TERMINAL | CANCELLED
```

Legacy single-entity research still uses `RESOLVING_IDENTITY` → `READY_FOR_REVIEW` (eval harness).

Each state is persisted. A failed GitHub call can retry without rerunning Exa discovery or duplicating a Notion page.

### 3.4 Research-Agent Loop

For each selected candidate, the agent receives the thesis, resolved identity, accumulated evidence, and typed read-only tools. It may request a limited number of calls, then produce a structured research output.

```text
resolve identity
  → inspect GitHub profile/repos/releases
  → fetch company website/blog/RSS
  → query independent public mentions
  → identify evidence gaps
  → perform one follow-up research round
  → finish with claims and open questions
```

**Proposed guardrail:** maximum 10–12 tool calls per candidate, source/content budget, and a stop condition. These limits keep latency and cost predictable.

### 3.5 Monitoring Flow

```text
Daily scheduler
  → load watched founders
  → poll source adapters
  → normalize events
  → deduplicate versus prior state
  → classify materiality
  → update Notion + Slack if material
  → retain silent event otherwise

Friday scheduler
  → write weekly newsletter (hero, company marks, editorial brief)
  → send Gmail
  → post a compact Slack digest (cron only; demo override does not re-post Slack)
```

Monitoring is not an Exa People recurring query. Exa is a discovery/identity layer; monitoring is based on direct public-source adapters.

---

## 4. Integrations and Responsibilities

| Integration | Role | MVP operations |
|---|---|---|
| Exa People Search | Professional-profile discovery; LinkedIn-like data without scraping LinkedIn | Search candidates, resolve role/company history |
| GitHub | Technical evidence and high-confidence signals | Read profile/repos/releases/events; poll watched repos |
| General web research | Independent/public company and founder context | Search and fetch public sources |
| Notion | Team source of truth | Create founder page; append signal timeline |
| Google Docs | Shareable long-form diligence memo | Create/update dossier |
| Slack | Dealflow discussion and urgent signal delivery | Create/post a founder thread; weekly digest |
| Gmail | Investor weekly newsletter | Send HTML letter with hero + company logos |

### 4.1 No LinkedIn Scraping

Scout will not scrape LinkedIn or automate a logged-in browser session. Exa People is used as an external professional-data provider. Any later import of a user-supplied LinkedIn URL must respect that source's applicable terms and should not be necessary for the MVP.

### 4.2 General-Web Research Options

| Approach | Pros | Cons | Recommendation |
|---|---|---|---|
| Tavily free-tier search + direct fetch | Hosted agent-oriented search; 1,000 free monthly API credits; no card required; rapid hackathon setup | Vendor dependency after free allowance | **Selected for hackathon**; hide behind a `SearchProvider` interface |
| Self-hosted SearXNG + direct fetch | Open-source, provider-portable, low marginal cost | Requires separate hosting; public instances are not reliable/appropriate for automated production use | Future self-hosted option, not the hackathon default |
| Paid search API adapter | Better relevance/uptime; simpler integration | Cost and vendor dependency | Future interchangeable provider option |
| Direct primary-source fetch only | Cheapest and highest source quality | Misses independent coverage and discovery context | Always use for known company/blog/GitHub URLs, but insufficient alone |
| Parallel Monitor/Search | Strong managed monitoring/search experience | Closed dependency and additional spend | Do not make core; optional future adapter only |

**Current direction:** Use Tavily's free tier for general web discovery in the hackathon, then fetch cited pages directly. The product exposes sources in the UI rather than hiding a search vendor behind an opaque answer.

---

## 5. Data Model

### 5.1 Core Records

```text
Workspace
  └─ ScoutRun
       ├─ Thesis
       ├─ Candidate
       │    ├─ Source
       │    ├─ Claim
       │    ├─ Dossier
       │    └─ Watch
       │         └─ SignalEvent
       └─ ActionReceipt
```

| Record | Key fields |
|---|---|
| `scout_runs` | thesis, state, model, started/finished time, cost counters |
| `candidates` | canonical name, Exa ID, GitHub handle, company/domain, score |
| `sources` | URL, source type, retrieved time, content hash, excerpt, source metadata |
| `claims` | category, text, confidence, source IDs, status |
| `watches` | candidate ID, source configuration, high-water marks, Slack thread ID, Notion page ID |
| `signal_events` | source event ID/hash, event time, materiality, assessment, dedupe key |
| `action_receipts` | action type, target app, external object ID, idempotency key, result |

### 5.2 Claim Types

| Type | Rule |
|---|---|
| Fact | Must cite one or more stored evidence records |
| Interpretation | Must point to the facts it interprets and be visibly labeled |
| Risk | Must state whether it is evidence-based or unknown |
| Open question | Must never be presented as a fact |

---

## 6. Key Design Decisions and Tradeoffs

All recommendations below require founder/team review before implementation.

### 6.1 Product Entry Point

**Question:** Is Scout a web app, a Slack app, or a Notion-native workflow?

- **A. Web app with Slack/Notion destinations (recommended):** Supports a rich research run, candidate comparison, dossier, and watchlist while still delivering work into team tools.
  - Pros: Best demo surface; supports complex evidence visualization; strongest product identity.
  - Cons: Requires building a product UI in addition to integrations.
- **B. Slack-first bot:** Thesis is submitted and returned in Slack.
  - Pros: Low adoption friction; faster to build.
  - Cons: Poor candidate comparison and weak visual demo; feels like another bot.
- **C. Notion-first agent:** Research is triggered from a Notion database.
  - Pros: Fits existing investment workflows.
  - Cons: Constrains the product to Notion; less visually distinctive.

**Recommendation:** A. The web app is the research cockpit; other tools are collaboration endpoints.

### 6.2 V1 Input and Entity Scope

**Question:** Should V1 start from a broad thesis search or a person/company supplied by the investor?

- **A. Thesis-first founder discovery:** Scout returns a broad candidate list from a natural-language investment thesis.
  - Pros: Strong sourcing vision and makes Exa discovery central.
  - Cons: Ranking an open-ended candidate list adds significant evaluation complexity and creates a less deterministic demo.
- **B. Entity-first diligence with optional thesis lens (recommended):** User supplies a person/company identifier; Scout resolves it, researches it deeply, and applies an optional investment lens.
  - Pros: Matches the stated investor workflow; tighter evidence chain; demo and evaluation are more controllable; supports both people and companies.
  - Cons: Does not yet solve top-of-funnel discovery by itself.
- **C. Company-first only:** User provides a company; Scout maps founders and market context.
  - Pros: Familiar for investor diligence.
  - Cons: Loses the distinctive technical-founder/GitHub angle.

**Current direction:** B. Exa is used only for person-level professional enrichment; it is not a requirement for company-only research.

### 6.3 Research Orchestration

**Question:** How autonomous should the research engine be?

- **A. Fully deterministic pipeline:** Fixed calls in a fixed order.
  - Pros: Predictable, easy to test, simple.
  - Cons: Cannot pursue candidate-specific evidence gaps; feels less agentic.
- **B. Unbounded ReAct-style agent:** Model decides all research, tools, and stopping conditions.
  - Pros: Flexible.
  - Cons: Cost/latency are unpredictable; difficult to secure/evaluate; poor hackathon reliability.
- **C. Deterministic outer workflow + bounded research loop (recommended):** Code owns lifecycle; model selects from read-only typed research tools within a budget.
  - Pros: Real agent behavior with reliable retries, review points, and testability.
  - Cons: More custom harness work than using a generic agent framework.

**Recommendation:** C. Build a small Scout-specific harness rather than adopt OpenHands or a multi-agent framework.

### 6.4 Research Source Policy

**Question:** Which sources are authoritative enough for investment claims?

- **A. Source-tiered policy (recommended):** GitHub/company site/research paper as primary evidence; independent articles/community discussion as contextual evidence; model-generated text is never evidence.
  - Pros: Clear trust model; easy to explain to judges.
  - Cons: Some interesting signals will be labeled lower confidence.
- **B. Treat all web results equally:** Fastest synthesis.
  - Pros: Simple.
  - Cons: Weak diligence quality and high hallucination/misattribution risk.
- **C. Primary sources only:** Restrict to direct artifacts.
  - Pros: Highest factual rigor.
  - Cons: Misses early external momentum and market perception.

**Recommendation:** A.

### 6.5 Candidate Ranking

**Question:** How should Scout rank candidates?

- **A. Single opaque LLM score:** Model returns 0–100.
  - Pros: Fast to prototype.
  - Cons: Impossible to defend; likely looks arbitrary.
- **B. Deterministic weighted score:** e.g., GitHub technical indicators + recency + thesis fit.
  - Pros: Reproducible and explainable.
  - Cons: Brittle; cannot capture nuanced founder quality.
- **C. Hybrid scorecard (recommended):** Deterministic evidence features feed a model-generated, explained conviction assessment; show component contributions.
  - Pros: Combines nuance with legibility.
  - Cons: Requires deliberate UI and evaluation design.

**Recommendation:** C. Present conviction as a recommendation, never a ground truth ranking.

**Selected scoring policy — holistic but explainable:**

Scout produces two separate normalized values. It never uses an opaque model-only score.

```text
Opportunity score = evidence-based investment recommendation (0–100)
Confidence score  = how complete, recent, and corroborated the evidence is (0–100)
```

| Opportunity factor | Weight | Normalized evidence inputs |
|---|---:|---|
| Technical credibility | 35% | Shipped repositories/releases, sustained contribution history, external contributors/adoption, technical writing/research |
| Momentum | 25% | Recent launches/releases, growth trend, new collaborators, current public activity |
| Thesis fit | 20% | Verified match to the investor's stated domain, stage, and technical focus |
| Company/product/market evidence | 20% | Product artifact quality, company clarity, independent validation, competitive differentiation |

Each factor is scored against fixed, published rubric bands from 0–100, then weighted. Use fixed bands rather than min-max normalization against the current search set so two founders can be compared across runs.

```text
base opportunity = 0.35 × technical + 0.25 × momentum
                 + 0.20 × thesis_fit + 0.20 × company_market

opportunity = clamp(round(base opportunity − verified_risk_penalty), 0, 100)
```

**Risk policy:** only verified negative evidence produces a penalty, capped at 15 points total. Examples: a directly contradictory public claim, a clearly abandoned flagship project, or a company state that conflicts with the selected thesis. Missing information is **not** a penalty; it lowers confidence and appears as an open question. This prevents Scout from systematically under-scoring early or stealth founders simply because public evidence is sparse.

**Confidence score:** 40% source quality, 30% cross-source corroboration, 20% recency, and 10% entity-resolution certainty. It is shown beside—not folded into—the opportunity score.

| Opportunity score | Label | Default investor action |
|---:|---|---|
| 80–100 | High conviction | Prioritize diligence/outreach |
| 65–79 | Promising | Validate named open questions |
| 45–64 | Watch | Monitor; insufficient current proof to prioritize |
| 0–44 | Low current conviction | Archive or revisit if new signals arrive |

The model may explain score components and surface qualitative nuance, but cannot alter formula inputs, weights, risk penalty, or the final label.

### 6.6 Monitoring Cadence and Sources

**Question:** How do we monitor without an expensive generic monitoring vendor?

- **A. Daily polling of direct adapters (recommended):** GitHub API, company RSS/blog, tracked public pages, and a web-search adapter; persist high-water marks and hashes.
  - Pros: Open architecture, source-specific, controllable cost.
  - Cons: Requires adapter/deduplication code.
- **B. Generic managed monitor API:** Send natural-language queries to an outside monitoring service.
  - Pros: Fastest broad-web coverage.
  - Cons: Adds vendor dependency/cost and makes Scout's central system less distinctive.
- **C. Scheduled full re-research:** Re-run all research every week.
  - Pros: Simplest implementation.
  - Cons: Expensive, noisy, slow, and poor at detecting actual deltas.

**Current direction:** A. Vercel Cron triggers a daily monitoring function; the function polls GitHub, company RSS/site, and Tavily-backed web search, then persists high-water marks and hashes. General-web monitoring is included in the MVP but must degrade gracefully if the search provider is unavailable.

### 6.7 Materiality Classification

**Question:** What earns a Slack alert?

- **A. All events alert:** Every commit, mention, and page change goes to Slack.
  - Pros: Very simple.
  - Cons: Alert fatigue destroys product value.
- **B. LLM-only classification:** Ask the model whether each event matters.
  - Pros: Flexible.
  - Cons: Inconsistent; hard to calibrate and test.
- **C. Rules gate + LLM explanation (recommended):** Deterministic rules identify likely material events; model explains the likely investment implication; investor can correct it.
  - Pros: Auditable, lower noise, still nuanced.
  - Cons: Requires initial threshold selection.

**Selected materiality policy:** deterministic event scoring gates alerts before the model writes an explanation. The model may describe an eligible event, but cannot elevate an ineligible event to Slack.

| Signal | Event score | Destination |
|---|---:|---|
| Funding, acquisition, public company launch, or a new non-fork public repository | 80 | Notion timeline + founder Slack thread + weekly Gmail recap |
| New tagged GitHub release | 70 | Notion timeline + founder Slack thread + weekly Gmail recap |
| GitHub stars grow by ≥25% and ≥10 absolute stars within 7 days | 60 | Notion timeline + founder Slack thread + weekly Gmail recap |
| At least 2 first-time external contributors within 7 days | 60 | Notion timeline + founder Slack thread + weekly Gmail recap |
| New company blog/RSS item independently classified as a product launch, customer announcement, or technical milestone | 60 | Notion timeline + founder Slack thread + weekly Gmail recap |
| Routine commits, minor page edits, or low-relevance mentions | 0–39 | Stored silently; available to the weekly synthesis only if corroborated |

**Alert threshold:** event score ≥60. Events are deduplicated by stable source/event ID or content hash. The weekly Gmail recap summarizes all material events and may group related minor events into one trend, but never represents a minor event as a milestone.

### 6.8 External Write Controls

**Question:** When should Scout take action in connected apps?

- **A. Autonomous writes:** Agent immediately creates docs/posts.
  - Pros: Fastest experience.
  - Cons: Risky and difficult to trust for investment work.
- **B. Batch approval before creating a diligence pack (recommended):** User reviews proposed Notion, Docs, and Slack writes, then approves them together.
  - Pros: Clean demo moment; preserves user control.
  - Cons: One approval step.
- **C. Per-action approval:** Confirm each write separately.
  - Pros: Maximum control.
  - Cons: Too much friction for a cohesive demo.

**Current direction:** Batch approval for the initial diligence pack. Material monitoring updates are authorized to write automatically to the founder/company Notion timeline and dedicated Slack thread; every write remains idempotent and has an action receipt. Gmail weekly recap is also an authorized scheduled write.

### 6.9 Agent Runtime Location

**Question:** Where should long-running work execute?

- **A. Next.js request handler:** Run research inside the web request.
  - Pros: Fewest moving parts.
  - Cons: Timeout/retry limitations; unsuitable for scheduled monitoring.
- **B. Vercel Cron + Vercel Functions + Postgres job state (recommended):** Vercel invokes protected production API routes on a schedule; routes claim work from Postgres and process a bounded watch batch.
  - Pros: Fits the chosen Vercel deployment; no separate worker vendor; daily cadence is sufficient for MVP.
  - Cons: Vercel does not retry failed cron invocations; function duration is bounded; code must provide locks, idempotency, batch limits, and retry state.
- **C. Full Temporal deployment:** Enterprise workflow engine.
  - Pros: Strong durability.
  - Cons: Far beyond hackathon scope.

**Current direction:** B. Configure Vercel Cron in `vercel.json` for a daily monitor route and a Friday Gmail-recap route. Cron routes validate `CRON_SECRET`, acquire a Postgres lock, claim a bounded batch, and persist a run record before external actions. This is required because Vercel can invoke cron more than once and does not automatically retry failures. On a Hobby account, daily is the minimum supported interval and scheduled time may vary within the configured UTC hour; that is acceptable for daily monitoring.

### 6.10 Model Strategy

**Question:** Which model architecture should Scout support?

- **A. One hosted model, hard-coded:** Fastest to ship.
  - Pros: Lowest integration burden.
  - Cons: Vendor lock-in and weak “agent runtime” story.
- **B. Anthropic API for the MVP (recommended):** Use one Anthropic model/provider with a provided API key; keep internal call boundaries clean without building other adapters.
  - Pros: Fastest path to a consistent demo and evaluation baseline.
  - Cons: No cross-provider comparison in the hackathon.
- **C. Local model only:** Privacy-forward.
  - Pros: Open-source narrative.
  - Cons: Quality/latency risk for research synthesis.

**Selected model:** `claude-sonnet-5`, Anthropic's current active Sonnet API model. Use a maximum of 10 tool calls and 12 fetched source documents per research run; stop early once required evidence categories are satisfied. Provider abstraction is a future refactor, not hackathon work.

### 6.11 Evaluation Philosophy

**Question:** Is citation enforcement and defensive code enough to establish agent reliability?

No. Citations and fail-safe connector code are baseline controls, but they do not establish that Scout reaches useful outcomes, handles ambiguity appropriately, follows the intended tool trajectory, or works consistently across repeated runs.

Relevant agent-evaluation practice supports evaluating the complete trajectory, not just a polished final answer:

- OpenHands runs task-specific suites for software work, general multi-step assistant tasks, and workplace safety, and retains structured tool-call/error logs for each evaluation instance.
- CAR-bench explicitly tests whether agents know when to gather more information, clarify ambiguity, or defer/refuse rather than hallucinate.
- Claw-Eval uses a strict `Pass³` standard: a task is credited only if it passes all three independent trials, separating dependable behavior from one lucky completion.
- Trace-based frameworks evaluate expected tool use, final outputs, and regression behavior from recorded trajectories.

**Approaches considered:**

- **A. Citation + unit tests only:** Validate source IDs, schemas, and connector helpers.
  - Pros: Fast and deterministic.
  - Cons: Does not measure whether research is useful, calibrated, or repeatable.
- **B. One-off demo review:** A human judges one founder dossier.
  - Pros: Low setup cost; useful qualitative feedback.
  - Cons: A successful demo is not evidence of reliable agent behavior.
- **C. Domain-specific trajectory evaluation suite (recommended):** Curated Scout scenarios, deterministic validators, selected human review, action-state checks, repeated trials, and regression tests.
  - Pros: Directly evaluates the product's real workflow and maps to hackathon reliability criteria.
  - Cons: Requires deliberate fixture authoring and reporting.

**Recommendation:** C. Scout should ship with a small but real evaluation suite and surface its real results in the repository/reliability brief. It must never invent a passing score for the demo.

### 6.12 Observability and Evaluation Platform

**Question:** Should Scout use Langfuse for observability and evaluation?

- **A. Application logs and a custom dashboard only:** Store run events in Postgres and build all trace/evaluation visualization ourselves.
  - Pros: No third-party telemetry dependency; complete control.
  - Cons: Expensive to build; weak experimentation, trace comparison, and evaluator-review experience for a hackathon.
- **B. Langfuse Cloud for the hackathon; self-hostable Langfuse path for production (recommended):** Instrument Scout's agent and connector calls with Langfuse traces, dataset experiments, scores, cost, and latency.
  - Pros: Production-shaped agent observability; makes the evaluation evidence inspectable; open-source/MIT and self-hostable later; avoids spending hackathon time building an observability product.
  - Cons: Cloud telemetry needs deliberate privacy controls; introduces one operational dependency for the demo.
- **C. A generic APM platform only:** Send logs and metrics to a conventional monitoring provider.
  - Pros: Familiar operational tooling.
  - Cons: Does not natively model LLM generations, tool trajectories, datasets, or evaluator scores.

**Recommendation:** B. Langfuse is the trace/experiment/inspection layer, not a replacement for Scout's own deterministic validators, action policies, or `Pass³` calculation.

**Instrumentation contract:**

```text
Scout run trace
  → discovery span (Exa)
  → research spans (GitHub, web, source fetch)
  → synthesis span (model)
  → validation span (citation + schema checks)
  → action spans (Notion, Docs, Slack, Gmail)
  → monitoring span (event detection + materiality)
```

Every trace records safe metadata: `run_id`, candidate ID/pseudonym, thesis category, model, tool count, state transitions, cost, latency, validator scores, and action outcomes. It must not record OAuth secrets or raw private workspace content. The hackathon uses public-source research; a production deployment should offer self-hosted Langfuse and configurable redaction.

---

## 7. Reliability, Safety, and Evaluation

### 7.1 Reliability Requirements

- Every displayed fact must have at least one stored source ID.
- A source is content, not instructions: retrieved web text must not change system policies or tool permissions.
- External writes require approved action proposals and idempotency keys.
- Connector failures retry independently and surface an actionable receipt.
- Monitor events deduplicate by provider event ID or stable content hash.
- The agent has bounded tool-call and content budgets.
- OAuth tokens remain server-side and use minimum scopes.

### 7.2 What Scout Evaluates

Scout has two distinct scores that must never be conflated:

```text
Founder conviction score = recommendation about a person/company
Agent reliability score  = measured quality of Scout's behavior
```

Founder conviction is evidence-backed, uncertainty-aware judgment. Agent reliability is computed from an evaluation suite and must be reproducible from saved fixtures, traces, and external-action receipts.

| Dimension | Question | Validator |
|---|---|---|
| Research outcome | Did the dossier surface the expected relevant work, background, and open questions? | Structured rubric plus targeted human review |
| Grounding | Does every factual claim cite evidence that supports it? | Deterministic source-ID and claim-to-source checks; sampled human entailment review |
| Calibration | Does Scout ask to disambiguate, mark uncertainty, or stop when evidence is insufficient? | Scenario pass/fail checks |
| Tool trajectory | Did it use relevant tools and stay within its research budget? | Trace assertions: expected/forbidden tools, call count, terminal state |
| Action correctness | Did it create the correct external objects exactly once? | External object IDs and idempotency assertions |
| Recovery | Did it retry/recover safely from connector failures? | Fault-injected connector scenarios |
| Monitoring | Did it alert on material change while suppressing routine noise? | Seeded event fixtures and expected classifications |
| Consistency | Does it pass repeatedly rather than once? | Strict `Pass³`: all three independent trials must pass |

### 7.3 Scout Evaluation Suite

The MVP target is 12 curated scenarios, each executed three times: **36 total trajectories**. The suite uses fixture adapters for repeatability; live integration smoke tests are reported separately and never substituted for deterministic evaluation.

| Scenario family | Count | Expected behavior |
|---|---:|---|
| Known founder/company research | 4 | Relevant evidence, supported claims, useful risks/open questions |
| Ambiguous identity | 2 | Ask for disambiguation or present alternatives; do not guess the identity |
| Insufficient evidence | 2 | State uncertainty and preserve open questions; do not manufacture conviction |
| Prompt-injection source | 1 | Treat retrieved text as data; ignore malicious instructions |
| Connector failure/rate limit | 1 | Retry/degrade honestly without inventing unavailable evidence |
| Duplicate external write | 1 | Second execution reuses stored receipt/object rather than creating duplicates |
| Monitoring signal/noise | 1 | Emit one material alert for a seeded GitHub release; suppress routine commits |

#### Fixture Design

- Fixtures pin person/company input, tool responses, source text, and expected app-state results.
- Source fixtures include stable URLs/excerpts and a small number of adversarial or incomplete records.
- The test runner captures model messages, tool calls, state transitions, claims, costs, latency, and action receipts.
- Each scenario declares deterministic success rules before it is executed.
- A failure discovered during development becomes a permanent regression case.

#### Pass Rules

1. **Hard gates:** no unsupported factual claim, unauthorized write, duplicate write, schema violation, prompt-injection policy violation, or unhandled terminal error.
2. **Task rubric:** scenario-specific expected evidence, uncertainty behavior, and final dossier fields must pass.
3. **Consistency gate:** the scenario receives a success credit only if all three independent attempts pass (`Pass³`).
4. **Human review:** sample final dossiers for factual entailment and investment usefulness; use this to refine fixtures/rubrics, not to override hard-gate failures.

### 7.4 Evaluation Reporting

Scout should expose an **Evaluation Console** in the web app or provide an exported report in the repository. It must show real run data, never target values presented as results.

```text
Scout Reliability Suite
36 trajectories | <actual pass count> passed | <actual partial count> partial

Grounded factual claims:  <actual %>
Unauthorized writes:      <actual count>
Duplicate writes:         <actual count>
Material signals:         <actual detected>/<actual expected>
Noise alerts:             <actual count>
Pass³ reliability:        <actual %>
```

Every evaluation run links to its trace: source fixtures, model/tool calls, validator outcomes, and external-action receipts. Trace capture makes review and failure diagnosis possible without rerunning expensive model calls.

Langfuse is the recommended trace and experiment viewer for this data. Scout's own UI should show a compact reliability summary and link to the corresponding Langfuse trace/experiment for engineering inspection; it should not attempt to duplicate the entire Langfuse interface.

### 7.5 Failure Behavior

| Failure | User-visible behavior | Recovery |
|---|---|---|
| Exa search fails | Run pauses in discovery with a clear retry action | Retry only discovery |
| GitHub rate limit/failure | Dossier marks GitHub evidence unavailable; does not invent it | Backoff/retry; retain other evidence |
| Web source fetch fails | Source is marked unavailable | Continue with other sources |
| Model output violates schema/citation policy | Dossier is not published | Retry structured synthesis or show review-needed state |
| Notion/Docs/Slack write fails | Individual receipt shows failed | Retry that action with same idempotency key |
| Monitor source fails | Preserve prior watch state; flag source health | Retry next cadence/manual check |

---

## 8. Demo Plan

### 8.1 Principle

The demo must show actual integrated behavior without relying on unpredictable cold-search latency or an unrelated real founder producing a new event on cue.

Use a real prior research run for the rich dossier, then perform real external writes and a real controlled monitoring event during the demonstration.

### 8.2 Two-Minute Walkthrough

| Time | Screen/action | What it proves |
|---|---|---|
| 0:00–0:15 | Enter a thesis on `/` and start a run | Thesis-first sourcing, not paste-one-company |
| 0:15–0:40 | Watch discovery, then select companies + Slack / newsletter / Notion | Bounded agent + human configure step |
| 0:40–1:05 | Parallel research cards fill; open the Google Doc report | Grounded conviction, outline-ready memo |
| 1:05–1:30 | Show Slack alert, Notion record, watchlist | Differentiated writes, not three copies |
| 1:30–1:50 | Send newsletter from the run page | Editorial weekly letter with logos |
| 1:50–2:00 | `/evals` — measured `evals/report.json` only (suite is pre-run; do not execute 36 trajectories live) | Reliability is measured, never invented |

The demo may use a clearly labeled cached/replayed research trace for speed, but write actions and monitor event must be real. It must not represent mocked calls as live integrations. A live thesis run can fill the two minutes by itself — in that case skip to `/evals` and show the pre-run reliability dashboard.

---

## 9. Proposed Technical Stack (Decision Pending)

| Layer | Option | Rationale | Decision status |
|---|---|---|---|
| Frontend | Next.js + TypeScript | Rapid web UI and Vercel-native server routes | Selected |
| UI | Tailwind + component library + motion | Fast polish and live-run animation | Selected |
| Database | Managed Postgres | Durable relational state, receipts, dedupe, watchlists | Selected |
| Jobs | Vercel Cron + protected Vercel Functions + Postgres job state | Daily monitoring and Friday Gmail recap; code handles locks/retries/idempotency | Selected |
| Live updates | Server-Sent Events | Simple one-way worker-to-browser run trace | Recommended; pending |
| Agent schema | TypeScript validation schemas | Enforce tool/claim/action contracts | Recommended; pending |
| Observability/evals | Langfuse Cloud for hackathon; self-hostable Langfuse later | Trace tool trajectories, datasets, experiments, scores, cost, and latency | Selected; public sources/redacted telemetry only |
| Hosting | Vercel + Neon Postgres | Fast demo deployment | Selected |

Suggested repository shape:

```text
scout/
  apps/
    web/                 # UI, auth, API/SSE routes, Vercel cron endpoints
  packages/
    core/                # state machine, agent runner, policies
    connectors/          # Exa, GitHub, Notion, Slack, Google, web search
    schemas/             # run, evidence, claim, signal, action contracts
    observability/       # Langfuse trace, score, and redaction adapters
  docs/
    DESIGN.md
```

### 9.1 Environment Configuration

Credentials are configured as Vercel environment-variable placeholders and must never be committed to the repository or exported to Langfuse traces.

```text
ANTHROPIC_API_KEY=
EXA_API_KEY=
TAVILY_API_KEY=
NOTION_API_KEY=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=
CRON_SECRET=
DATABASE_URL=
```

---

## 10. Hackathon Build Plan

This sequence is intentionally biased toward a credible, finishable demo rather than broad product completeness.

| Phase | Deliverable | Priority |
|---|---|---|
| 1 | Web shell, Scout Run UI, database schema, seeded data | Must have |
| 2 | Exa person enrichment + GitHub/company evidence connectors | Must have |
| 3 | Bounded research loop, source storage, structured dossier | Must have |
| 4 | Notion + Google Docs + Slack approved action pack | Must have |
| 5 | GitHub watch check, dedupe, Notion/Slack material signal | Must have |
| 6 | Demo polish, SSE trace, evaluation fixtures, action receipts | Must have |
| 7 | Gmail weekly newsletter and general-web monitoring | Must have |

### Explicit MVP Cut Line

If time is constrained, ship a high-quality flow for **one supplied person/company, one deeply sourced dossier, GitHub/company monitoring, and three real write integrations**. Do not trade that reliability for broad but unverified discovery coverage.

---

## 11. Decisions to Review and Lock Next

1. Lock the product name: **Scout** remains a working name.
2. Validate the selected scoring/materiality defaults against the first evaluation fixtures, then tune only from observed failures.
3. Finalize credential setup: Anthropic, Exa, Tavily, Notion, Google, Slack, Langfuse, and Vercel `CRON_SECRET`.

---

## 12. References

- [Exa People Search documentation](https://exa.ai/docs/reference/verticals/people)
- [Parallel Monitor product reference](https://parallel.ai/products/monitor) — product inspiration only; not a planned core dependency
- [GitHub REST API documentation](https://docs.github.com/en/rest)
- [Notion API documentation](https://developers.notion.com/)
- [Slack Web API documentation](https://api.slack.com/web)
- [Google Docs API documentation](https://developers.google.com/docs/api)
- [OpenAI Evals guide](https://developers.openai.com/api/docs/guides/evals)
- [OpenHands benchmarks](https://github.com/OpenHands/benchmarks)
- [CAR-bench](https://github.com/CAR-bench/car-bench)
- [Claw-Eval](https://github.com/claw-eval/claw-eval)
- [agentevals trace-based evaluation](https://github.com/agentevals-dev/agentevals)
- [Langfuse](https://langfuse.com/)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Tavily pricing and free credits](https://docs.tavily.com/documentation/api-credits)
- [Anthropic model deprecations and active models](https://docs.anthropic.com/en/docs/about-claude/model-deprecations)
