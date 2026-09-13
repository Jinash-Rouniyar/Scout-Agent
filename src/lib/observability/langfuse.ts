import { Langfuse } from "langfuse";
import { optionalEnv } from "@/env";
import { redact } from "./redaction";

/**
 * Thin Langfuse wrapper. When keys are absent (local/eval without telemetry) it
 * degrades to a no-op so the agent runs identically. All payloads pass through
 * `redact()` so no secrets or raw private content are transmitted.
 */
let client: Langfuse | null | undefined;

function getClient(): Langfuse | null {
  if (client !== undefined) return client;
  const publicKey = optionalEnv("LANGFUSE_PUBLIC_KEY");
  const secretKey = optionalEnv("LANGFUSE_SECRET_KEY");
  if (!publicKey || !secretKey) {
    client = null;
    return client;
  }
  client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: optionalEnv("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com",
  });
  return client;
}

export interface Trace {
  span(name: string, input?: unknown): Span;
  score(name: string, value: number, comment?: string): void;
  update(output: unknown): void;
  end(): Promise<void>;
  id: string | null;
}

export interface Span {
  end(output?: unknown): void;
  event(name: string, payload?: unknown): void;
}

export function startTrace(name: string, metadata: Record<string, unknown>): Trace {
  const lf = getClient();
  const trace = lf?.trace({ name, metadata: redact(metadata) as Record<string, unknown> });

  return {
    id: trace?.id ?? null,
    span(spanName, input) {
      const s = trace?.span({ name: spanName, input: redact(input) });
      return {
        end(output) {
          s?.end({ output: redact(output) });
        },
        event(evName, payload) {
          s?.event({ name: evName, metadata: redact(payload) as Record<string, unknown> });
        },
      };
    },
    score(scoreName, value, comment) {
      trace?.score({ name: scoreName, value, comment });
    },
    update(output) {
      trace?.update({ output: redact(output) });
    },
    async end() {
      await lf?.flushAsync().catch(() => {});
    },
  };
}

/** Build a Langfuse trace URL for the console, when configured. */
export function traceUrl(traceId: string | null): string | null {
  if (!traceId) return null;
  const base = optionalEnv("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com";
  return `${base.replace(/\/$/, "")}/trace/${traceId}`;
}
