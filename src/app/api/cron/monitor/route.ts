import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/core/cron";
import { runMonitorBatch } from "@/lib/core/monitorJob";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily monitoring — scheduled at 0 14 * * * (see vercel.json). */
export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runMonitorBatch();
  return NextResponse.json(summary);
}
