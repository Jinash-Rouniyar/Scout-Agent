import { NextResponse } from "next/server";
import { acquireLease, claimCronRun, finishCronRun, releaseLease, validateCronSecret, windowKey } from "@/lib/core/cron";
import { runWeeklyRecap } from "@/lib/core/recap";
import { id } from "@/lib/util/ids";
import { startTrace } from "@/lib/observability/langfuse";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Friday weekly recap — scheduled at 0 16 * * 5 (see vercel.json). Sends a real
 *  Gmail email and posts a compact Slack digest. */
export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const holderId = id("holder");
  if (!(await acquireLease("recap", holderId))) {
    return NextResponse.json({ ran: false, reason: "lease-held" });
  }
  try {
    const period = windowKey("recap");
    const cronRun = await claimCronRun("recap", period);
    if (!cronRun.fresh) {
      return NextResponse.json({ ran: false, reason: "window-already-processed" });
    }
    const trace = startTrace("scout.recap", { period });
    const result = await runWeeklyRecap({ trace });
    await finishCronRun(cronRun.id, "completed", result, 1);
    await trace.end();
    return NextResponse.json({ ran: true, ...result });
  } finally {
    await releaseLease("recap", holderId);
  }
}
