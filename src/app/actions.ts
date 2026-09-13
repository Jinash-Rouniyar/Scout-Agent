"use server";

import { runWeeklyRecap } from "@/lib/core/recap";
import { startTrace } from "@/lib/observability/langfuse";

/**
 * Demo/dev trigger for the weekly newsletter. Callable from the client (run
 * page "Send newsletter" button) so you can show the letter landing without
 * waiting for the Friday cron.
 */
export async function triggerWeeklyRecap(to?: string): Promise<{
  ok: boolean;
  period?: string;
  materialCount?: number;
  emailResult?: string;
  emailId?: string;
  error?: string;
}> {
  const dest = to?.trim();
  if (dest && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
    return { ok: false, error: "Enter a valid email address" };
  }
  const trace = startTrace("scout-recap", { forced: true, to: dest });
  try {
    const result = await runWeeklyRecap({ force: true, trace, to: dest });
    return {
      ok: result.gmail.result === "success",
      period: result.period,
      materialCount: result.materialCount,
      emailResult: result.gmail.result,
      emailId: result.gmail.externalId,
      error: result.gmail.error,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "recap failed" };
  } finally {
    await trace.end();
  }
}
