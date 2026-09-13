import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "@/env";

/** Selected model per design: Anthropic's current active Sonnet. Overridable. */
export const SCOUT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return cached;
}
