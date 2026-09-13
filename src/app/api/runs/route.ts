import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { scoutRuns } from "@/lib/db/schema";
import { id } from "@/lib/util/ids";
import { detectInputKind } from "@/lib/core/input";
import { emit } from "@/lib/core/events";

export const dynamic = "force-dynamic";

const Body = z.object({
  input: z.string().min(1).max(2000),
  thesis: z.string().max(2000).optional(),
});

/** Create a run. Execution happens synchronously via GET /api/runs/:id/execute. */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const runId = id("run");
  const inputKind = detectInputKind(body.input);

  await db.insert(scoutRuns).values({
    id: runId,
    input: body.input.trim(),
    inputKind,
    thesis: body.thesis?.trim() || null,
    state: "CREATED",
  });
  await emit(runId, "run.created", { input: body.input.trim(), inputKind, thesis: body.thesis ?? null });

  return NextResponse.json({ id: runId, inputKind });
}
