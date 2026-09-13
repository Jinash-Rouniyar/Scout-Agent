import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  bigserial,
  uniqueIndex,
  index,
  boolean,
  doublePrecision,
} from "drizzle-orm/pg-core";

/**
 * Scout data model.
 *
 * Uniqueness constraints are correctness-critical (idempotency, dedupe, cron
 * single-flight), not incidental:
 *   sources(url, content_hash)          unique
 *   signal_events(dedupe_key)           unique
 *   action_receipts(idempotency_key)    unique
 *   snapshots(entity_id, source, captured_at) unique
 *   cron_runs(kind, scheduled_for)      unique
 *   cron_leases(kind)                   unique (primary key)
 */

// ---- Runs --------------------------------------------------------------------

export const scoutRuns = pgTable("scout_runs", {
  id: text("id").primaryKey(),
  // For thesis runs this holds the thesis text (input_kind = "thesis").
  input: text("input").notNull(),
  inputKind: text("input_kind").notNull(), // thesis | github_url | company_url | profile_url | name
  thesis: text("thesis"),
  state: text("state").notNull().default("CREATED"),
  entityId: text("entity_id"),
  model: text("model"),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  docFetchCount: integer("doc_fetch_count").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// ---- Entities & identity resolution -----------------------------------------

export const entities = pgTable("entities", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // person | company
  canonicalName: text("canonical_name").notNull(),
  exaId: text("exa_id"),
  githubLogin: text("github_login"),
  // Confirmed linked GitHub accounts (logins) for a person.
  linkedGithubAccounts: jsonb("linked_github_accounts").$type<string[]>().default([]),
  companyDomain: text("company_domain"),
  companyGithubOrg: text("company_github_org"),
  companyRepos: jsonb("company_repos").$type<string[]>().default([]),
  // Identity context only; never fetched/scraped.
  profileUrl: text("profile_url"),
  identityConfidence: doublePrecision("identity_confidence"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const identityCandidates = pgTable(
  "identity_candidates",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    rank: integer("rank").notNull(),
    name: text("name").notNull(),
    exaId: text("exa_id"),
    githubLogin: text("github_login"),
    companyDomain: text("company_domain"),
    confidence: doublePrecision("confidence").notNull(),
    summary: text("summary"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byRun: index("identity_candidates_run_idx").on(t.runId),
  }),
);

// ---- Thesis discovery: candidate companies ----------------------------------

/**
 * Companies surfaced by the discovery agent from an investment thesis. Each row
 * is a candidate the user can select for a diligence pack, choosing per-company
 * delivery options (Slack monitor / newsletter / Notion record). Once selected
 * it is enriched in place with the diligence result (entity, scores, artifacts).
 */
export const discoveredCompanies = pgTable(
  "discovered_companies",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    rank: integer("rank").notNull(),
    name: text("name").notNull(),
    domain: text("domain"),
    githubOrg: text("github_org"),
    oneLiner: text("one_liner"),
    whyMatch: text("why_match"),
    raw: jsonb("raw"),
    // User selection + per-company delivery options.
    selected: boolean("selected").notNull().default(false),
    optSlack: boolean("opt_slack").notNull().default(false),
    optEmail: boolean("opt_email").notNull().default(false),
    optNotion: boolean("opt_notion").notNull().default(false),
    // Diligence result (filled after research + writes).
    status: text("status").notNull().default("pending"), // pending | researching | ready | failed
    entityId: text("entity_id"),
    dossierId: text("dossier_id"),
    opportunityScore: integer("opportunity_score"),
    confidenceScore: integer("confidence_score"),
    label: text("label"),
    whyNow: text("why_now"),
    summary: text("summary"),
    docUrl: text("doc_url"),
    docId: text("doc_id"),
    notionPageId: text("notion_page_id"),
    slackThreadTs: text("slack_thread_ts"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byRun: index("discovered_companies_run_idx").on(t.runId),
  }),
);

// ---- Evidence & claims -------------------------------------------------------

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    runId: text("run_id"),
    entityId: text("entity_id"),
    url: text("url").notNull(),
    sourceType: text("source_type").notNull(), // github | company_site | rss | web | paper | exa
    tier: text("tier").notNull().default("contextual"), // primary | contextual
    title: text("title"),
    excerpt: text("excerpt"),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    urlHashUnique: uniqueIndex("sources_url_hash_unique").on(t.url, t.contentHash),
    byRun: index("sources_run_idx").on(t.runId),
  }),
);

export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    entityId: text("entity_id"),
    category: text("category").notNull(), // fact | interpretation | risk | open_question
    text: text("text").notNull(),
    confidence: doublePrecision("confidence"),
    sourceIds: jsonb("source_ids").$type<string[]>().default([]),
    status: text("status").notNull().default("pending"), // pending | validated | rejected
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byRun: index("claims_run_idx").on(t.runId),
  }),
);

export const dossiers = pgTable("dossiers", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  entityId: text("entity_id"),
  whyNow: text("why_now"),
  summary: text("summary"),
  opportunityScore: integer("opportunity_score"),
  confidenceScore: integer("confidence_score"),
  scoreBreakdown: jsonb("score_breakdown"),
  label: text("label"),
  timeline: jsonb("timeline"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---- Watches, snapshots, signals ---------------------------------------------

export const watches = pgTable("watches", {
  id: text("id").primaryKey(),
  entityId: text("entity_id").notNull(),
  runId: text("run_id"),
  active: boolean("active").notNull().default(true),
  sourceConfig: jsonb("source_config"),
  slackThreadTs: text("slack_thread_ts"),
  notionPageId: text("notion_page_id"),
  docUrl: text("doc_url"),
  // Per-watch delivery options chosen at diligence time.
  slackMonitor: boolean("slack_monitor").notNull().default(true),
  weeklyEmail: boolean("weekly_email").notNull().default(false),
  notionRecord: boolean("notion_record").notNull().default(true),
  watchStart: timestamp("watch_start", { withTimezone: true }).defaultNow().notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  // per-entity failure counter used for retry<=3 across cron runs
  failureCount: integer("failure_count").notNull().default(0),
  terminalFailure: boolean("terminal_failure").notNull().default(false),
});

export const snapshots = pgTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").notNull(),
    source: text("source").notNull(), // github | rss | web
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    data: jsonb("data").notNull(),
    contentHash: text("content_hash"),
  },
  (t) => ({
    unique: uniqueIndex("snapshots_entity_source_captured_unique").on(t.entityId, t.source, t.capturedAt),
    byEntity: index("snapshots_entity_idx").on(t.entityId),
  }),
);

export const signalEvents = pgTable(
  "signal_events",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").notNull(),
    watchId: text("watch_id"),
    kind: text("kind").notNull(), // funding | company_launch | new_repo | release | star_growth | contributors | rss_launch | web_launch | noise
    source: text("source").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    materiality: integer("materiality").notNull(),
    assessment: text("assessment"),
    citationUrl: text("citation_url"),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dedupeUnique: uniqueIndex("signal_events_dedupe_unique").on(t.dedupeKey),
    byEntity: index("signal_events_entity_idx").on(t.entityId),
  }),
);

// ---- Action receipts (idempotency authority) ---------------------------------

export const actionReceipts = pgTable(
  "action_receipts",
  {
    id: text("id").primaryKey(),
    actionType: text("action_type").notNull(), // notion_page | notion_timeline | slack_thread | slack_post | google_doc | gmail_recap
    targetApp: text("target_app").notNull(), // notion | slack | google_docs | gmail
    entityId: text("entity_id"),
    // period (weekly recap) or event id (monitoring) participating in the idempotency key
    scopeKey: text("scope_key"),
    idempotencyKey: text("idempotency_key").notNull(),
    externalObjectId: text("external_object_id"),
    result: text("result").notNull().default("pending"), // pending | success | failed
    attemptCount: integer("attempt_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex("action_receipts_idempotency_unique").on(t.idempotencyKey),
    byEntity: index("action_receipts_entity_idx").on(t.entityId),
  }),
);

// ---- Durable run event stream (SSE) ------------------------------------------

export const runEvents = pgTable(
  "run_events",
  {
    // Monotonic event id used as SSE id / Last-Event-ID cursor.
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    runId: text("run_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byRun: index("run_events_run_idx").on(t.runId, t.seq),
  }),
);

// ---- Cron durability ---------------------------------------------------------

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // monitor | recap
    scheduledFor: text("scheduled_for").notNull(), // e.g. 2026-09-13 (UTC date/window key)
    status: text("status").notNull().default("running"), // running | completed | failed
    cursor: integer("cursor").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    result: jsonb("result"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    unique: uniqueIndex("cron_runs_kind_scheduled_unique").on(t.kind, t.scheduledFor),
  }),
);

export const cronLeases = pgTable("cron_leases", {
  kind: text("kind").primaryKey(),
  holderId: text("holder_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type ScoutRun = typeof scoutRuns.$inferSelect;
export type DiscoveredCompany = typeof discoveredCompanies.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type Dossier = typeof dossiers.$inferSelect;
export type Watch = typeof watches.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type SignalEvent = typeof signalEvents.$inferSelect;
export type ActionReceipt = typeof actionReceipts.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type CronRun = typeof cronRuns.$inferSelect;
