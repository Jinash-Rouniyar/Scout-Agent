import { startObservation, propagateAttributes, type LangfuseSpan } from "@langfuse/tracing";
import { optionalEnv } from "@/env";
import { ensureTracing, flushTracing } from "@/instrumentation";
import { redact } from "./redaction";

/**
 * Langfuse wrapper on the current JS SDK (`@langfuse/tracing` + OTEL).
 *
 * Matches https://langfuse.com/docs/observability/get-started (JS/TS SDK):
 *   - OpenTelemetry collector started from instrumentation.ts
 *   - startObservation / parent.startObservation for the tree
 *   - asType: agent | generation | tool | retriever | span
 *   - forceFlush on end() (required for Next.js / short-lived requests)
 *
 * Callers keep a small Trace/Span API so the pipeline does not import OTEL.
 */

export type ObservationType = "span" | "generation" | "agent" | "tool" | "retriever" | "evaluator";

export interface GenerationOpts {
  model?: string;
  parent?: Span;
}

export interface Trace {
  span(name: string, input?: unknown, parent?: Span): Span;
  tool(name: string, input?: unknown, parent?: Span): Span;
  generation(name: string, input?: unknown, opts?: GenerationOpts): Span;
  score(name: string, value: number, comment?: string): void;
  update(output: unknown): void;
  end(): Promise<void>;
  id: string | null;
}

export interface Span {
  span(name: string, input?: unknown): Span;
  tool(name: string, input?: unknown): Span;
  generation(name: string, input?: unknown, opts?: Omit<GenerationOpts, "parent">): Span;
  end(output?: unknown): void;
  event(name: string, payload?: unknown): void;
  readonly id: string | null;
  readonly _raw: unknown;
}

const NOOP_SPAN: Span = {
  span: () => NOOP_SPAN,
  tool: () => NOOP_SPAN,
  generation: () => NOOP_SPAN,
  end: () => {},
  event: () => {},
  id: null,
  _raw: null,
};

function isEnabled(): boolean {
  return Boolean(optionalEnv("LANGFUSE_PUBLIC_KEY") && optionalEnv("LANGFUSE_SECRET_KEY"));
}

function retrieverName(name: string): boolean {
  return /search|fetch|github|retrieve/i.test(name);
}

function childOf(
  parent: LangfuseSpan,
  name: string,
  input: unknown,
  asType: ObservationType,
  extra?: Record<string, unknown>,
): LangfuseSpan {
  return parent.startObservation(
    name,
    { input: redact(input), ...extra } as never,
    { asType } as never,
  );
}

function wrapObs(raw: LangfuseSpan): Span {
  return {
    _raw: raw,
    id: raw.id,
    span(name, input) {
      return wrapObs(childOf(raw, name, input, "span"));
    },
    tool(name, input) {
      return wrapObs(childOf(raw, name, input, retrieverName(name) ? "retriever" : "tool"));
    },
    generation(name, input, opts) {
      return wrapObs(childOf(raw, name, input, "generation", opts?.model ? { model: opts.model } : undefined));
    },
    end(output) {
      const usage = extractUsage(output);
      raw.update({
        output: redact(output),
        ...(usage ? { usageDetails: usage } : {}),
      } as never);
      raw.end();
    },
    event(evName, payload) {
      const ev = childOf(raw, evName, payload, "span");
      ev.update({ metadata: redact(payload) as Record<string, unknown> } as never);
      ev.end();
    },
  };
}

function extractUsage(output: unknown): { input: number; output: number } | null {
  if (!output || typeof output !== "object") return null;
  const usage = (output as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  if (!usage) return null;
  return { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 };
}

function rootAsType(name: string): ObservationType {
  if (/discovery|diligence|run|monitor|recap/i.test(name)) return "agent";
  return "span";
}

export function startTrace(name: string, metadata: Record<string, unknown>): Trace {
  if (!isEnabled()) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[langfuse] disabled — LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set");
    }
    return NOOP_TRACE;
  }

  ensureTracing();

  const runId = typeof metadata.run_id === "string" ? metadata.run_id : undefined;
  const safeMeta = redact(metadata) as Record<string, unknown>;

  let root!: LangfuseSpan;
  propagateAttributes(
    {
      sessionId: runId,
      tags: ["scout"],
      metadata: { ...safeMeta, environment: process.env.NODE_ENV ?? "development" },
    },
    () => {
      root = startObservation(
        name,
        { input: safeMeta, metadata: safeMeta },
        { asType: rootAsType(name) } as never,
      );
    },
  );

  return {
    id: root.traceId,
    span(spanName, input, parent) {
      const p = (parent?._raw as LangfuseSpan | undefined) ?? root;
      return wrapObs(childOf(p, spanName, input, "span"));
    },
    tool(toolName, input, parent) {
      const p = (parent?._raw as LangfuseSpan | undefined) ?? root;
      return wrapObs(childOf(p, toolName, input, retrieverName(toolName) ? "retriever" : "tool"));
    },
    generation(spanName, input, opts) {
      const p = (opts?.parent?._raw as LangfuseSpan | undefined) ?? root;
      return wrapObs(
        childOf(p, spanName, input, "generation", opts?.model ? { model: opts.model } : undefined),
      );
    },
    score(scoreName, value, comment) {
      const ev = childOf(root, "record-score", { scoreName, value, comment }, "evaluator");
      ev.update({ output: { scoreName, value, comment } } as never);
      ev.end();
    },
    update(output) {
      root.update({ output: redact(output) } as never);
    },
    async end() {
      root.end();
      try {
        await flushTracing();
      } catch (e) {
        console.warn("[langfuse] flush failed — traces may not be ingested:", e);
      }
    },
  };
}

export const NOOP_TRACE: Trace = {
  id: null,
  span: () => NOOP_SPAN,
  tool: () => NOOP_SPAN,
  generation: () => NOOP_SPAN,
  score: () => {},
  update: () => {},
  end: async () => {},
};

export function traceUrl(traceId: string | null): string | null {
  if (!traceId) return null;
  const base = optionalEnv("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com";
  return `${base.replace(/\/$/, "")}/trace/${traceId}`;
}
