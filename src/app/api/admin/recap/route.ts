import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEnv } from "@/env";
import { runWeeklyRecap } from "@/lib/core/recap";
import { startTrace } from "@/lib/observability/langfuse";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ asOfDate: z.string().datetime().optional() });

/**
 * Demo-only manual trigger for the weekly recap. Vercel Cron only runs against
 * production and does not retry failures, so rehearsals invoke this same
 * function with { force: true }. The shared recap idempotency receipt ensures a
 * manual run and the real Friday cron never double-send.
 *
 * Auth: X-Admin-Token must equal ADMIN_TOKEN.
 */
export async function POST(req: Request) {
  const expected = requireEnv("ADMIN_TOKEN");
  if (req.headers.get("x-admin-token") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let asOfDate: Date | undefined;
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    asOfDate = body.asOfDate ? new Date(body.asOfDate) : undefined;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const trace = startTrace("scout.recap.manual", { forced: true });
  const result = await runWeeklyRecap({ force: true, asOfDate, trace });
  await trace.end();
  return NextResponse.json({ ok: true, ...result });
}
