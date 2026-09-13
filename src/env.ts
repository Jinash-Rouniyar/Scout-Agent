import { z } from "zod";

/**
 * Environment validation.
 *
 * DATABASE_URL is the only always-required variable (the app cannot boot
 * without persistence). Every other credential is validated lazily via
 * `requireEnv(...)` at the point of use, so the app and the evaluation suite
 * (which mocks connectors) can run without every live key configured.
 *
 * Secrets are NEVER logged and NEVER forwarded to Langfuse (see observability/redaction.ts).
 */
const bootSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SCOUT_USE_FIXTURES: z.string().optional().default("0"),
});

const optionalKeys = [
  "ANTHROPIC_API_KEY",
  "EXA_API_KEY",
  "TAVILY_API_KEY",
  "GITHUB_TOKEN",
  "NOTION_API_KEY",
  "NOTION_DATABASE_ID",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_CHANNEL_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "RECAP_TO_EMAIL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
  "CRON_SECRET",
  "ADMIN_TOKEN",
] as const;

export type OptionalEnvKey = (typeof optionalKeys)[number];

let cached: z.infer<typeof bootSchema> | null = null;

export function env(): z.infer<typeof bootSchema> {
  if (cached) return cached;
  const parsed = bootSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** True when connectors should resolve from deterministic fixtures. */
export function useFixtures(): boolean {
  return (process.env.SCOUT_USE_FIXTURES ?? "0") === "1";
}

/** Read an optional credential, throwing a clear error only when it is actually needed. */
export function requireEnv(key: OptionalEnvKey): string {
  const value = process.env[key];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable ${key}. Set it in your environment or Vercel project settings.`);
  }
  return value;
}

/** Read an optional credential without throwing. */
export function optionalEnv(key: OptionalEnvKey): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}
