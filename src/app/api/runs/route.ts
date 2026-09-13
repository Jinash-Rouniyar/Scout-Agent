import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { scoutRuns } from "@/lib/db/schema";
import { id } from "@/lib/util/ids";
import { emit } from "@/lib/core/events";

export const dynamic = "force-dynamic";

const Body = z.object({
  thesis: z.string().min(1).max(2000),
});

/**
 * Create a thesis run. Scout will discover 5-8 matching companies via
 * GET /api/runs/:id/execute, then wait for the user's selection.
 */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "A thesis is required" }, { status: 400 });
  }

  const runId = id("run");
  const thesis = body.thesis.trim();

  await db.insert(scoutRuns).values({
    id: runId,
    input: thesis,
    inputKind: "thesis",
    thesis,
    state: "CREATED",
  });
  await emit(runId, "run.created", { thesis });

  return NextResponse.json({ id: runId });
}
