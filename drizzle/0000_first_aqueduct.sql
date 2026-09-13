CREATE TABLE "action_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"action_type" text NOT NULL,
	"target_app" text NOT NULL,
	"entity_id" text,
	"scope_key" text,
	"idempotency_key" text NOT NULL,
	"external_object_id" text,
	"result" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"entity_id" text,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"confidence" double precision,
	"source_ids" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_leases" (
	"kind" text PRIMARY KEY NOT NULL,
	"holder_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"scheduled_for" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dossiers" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"entity_id" text,
	"why_now" text,
	"summary" text,
	"opportunity_score" integer,
	"confidence_score" integer,
	"score_breakdown" jsonb,
	"label" text,
	"timeline" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"canonical_name" text NOT NULL,
	"exa_id" text,
	"github_login" text,
	"linked_github_accounts" jsonb DEFAULT '[]'::jsonb,
	"company_domain" text,
	"company_github_org" text,
	"company_repos" jsonb DEFAULT '[]'::jsonb,
	"profile_url" text,
	"identity_confidence" double precision,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"rank" integer NOT NULL,
	"name" text NOT NULL,
	"exa_id" text,
	"github_login" text,
	"company_domain" text,
	"confidence" double precision NOT NULL,
	"summary" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scout_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"input" text NOT NULL,
	"input_kind" text NOT NULL,
	"thesis" text,
	"state" text DEFAULT 'CREATED' NOT NULL,
	"entity_id" text,
	"model" text,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"doc_fetch_count" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"watch_id" text,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"materiality" integer NOT NULL,
	"assessment" text,
	"citation_url" text,
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"source" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"entity_id" text,
	"url" text NOT NULL,
	"source_type" text NOT NULL,
	"tier" text DEFAULT 'contextual' NOT NULL,
	"title" text,
	"excerpt" text,
	"content_hash" text NOT NULL,
	"metadata" jsonb,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watches" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"run_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"source_config" jsonb,
	"slack_thread_ts" text,
	"notion_page_id" text,
	"watch_start" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"terminal_failure" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "action_receipts_idempotency_unique" ON "action_receipts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "action_receipts_entity_idx" ON "action_receipts" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "claims_run_idx" ON "claims" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cron_runs_kind_scheduled_unique" ON "cron_runs" USING btree ("kind","scheduled_for");--> statement-breakpoint
CREATE INDEX "identity_candidates_run_idx" ON "identity_candidates" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_events_dedupe_unique" ON "signal_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "signal_events_entity_idx" ON "signal_events" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_entity_source_captured_unique" ON "snapshots" USING btree ("entity_id","source","captured_at");--> statement-breakpoint
CREATE INDEX "snapshots_entity_idx" ON "snapshots" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_url_hash_unique" ON "sources" USING btree ("url","content_hash");--> statement-breakpoint
CREATE INDEX "sources_run_idx" ON "sources" USING btree ("run_id");