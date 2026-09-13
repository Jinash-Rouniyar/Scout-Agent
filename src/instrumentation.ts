import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/**
 * Official Langfuse JS/TS setup for Next.js:
 * https://langfuse.com/docs/observability/get-started
 *
 * Processor is constructed lazily with explicit keys + host so Next.js / tsx
 * never export against a missing env or the wrong region.
 */
let langfuseSpanProcessor: LangfuseSpanProcessor | null = null;
let started = false;

export function getLangfuseSpanProcessor(): LangfuseSpanProcessor | null {
  if (langfuseSpanProcessor) return langfuseSpanProcessor;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  langfuseSpanProcessor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    exportMode: "immediate",
    flushAt: 1,
  });
  return langfuseSpanProcessor;
}

export function ensureTracing(): void {
  if (started) return;
  const processor = getLangfuseSpanProcessor();
  if (!processor) return;
  started = true;
  const provider = new NodeTracerProvider({
    spanProcessors: [processor],
  });
  provider.register();
}

export async function flushTracing(): Promise<void> {
  const processor = getLangfuseSpanProcessor();
  if (!processor) return;
  await processor.forceFlush();
}

/** Next.js 15 calls this once per server process. Skip Edge — OTEL is Node-only. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  ensureTracing();
}
