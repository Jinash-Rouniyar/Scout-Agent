import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scoutRuns, discoveredCompanies } from "@/lib/db/schema";
import { emit, transition } from "@/lib/core/events";

export const dynamic = "force-dynamic";

const Body = z.object({
  selections: z
    .array(
      z.object({
        companyId: z.string(),
        slack: z.boolean().default(true),
        email: z.boolean().default(true),
        notion: z.boolean().default(true),
      }),
    )
    .min(1),
});

/**
 * Persist the user's company selection + per-company delivery options and move
 * the run into RESEARCHING. The client then drives GET /execute, which runs the
 * selected companies' diligence in parallel.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid selection" }, { status: 400 });
  }

  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.state !== "AWAITING_SELECTION") {
    return NextResponse.json({ error: `run is ${run.state}, not awaiting selection` }, { status: 409 });
  }

  const selectedIds = body.selections.map((s) => s.companyId);
  const rows = await db
    .select()
    .from(discoveredCompanies)
    .where(and(eq(discoveredCompanies.runId, runId), inArray(discoveredCompanies.id, selectedIds)));
  const valid = new Set(rows.map((r) => r.id));

  // Reset all companies to unselected, then apply the chosen ones + options.
  await db.update(discoveredCompanies).set({ selected: false }).where(eq(discoveredCompanies.runId, runId));
  for (const s of body.selections) {
    if (!valid.has(s.companyId)) continue;
    await db
      .update(discoveredCompanies)
      .set({ selected: true, optSlack: s.slack, optEmail: s.email, optNotion: s.notion, status: "pending", updatedAt: new Date() })
      .where(eq(discoveredCompanies.id, s.companyId));
  }

  await emit(runId, "company.selected", { count: valid.size });
  await transition(runId, "AWAITING_SELECTION", "RESEARCHING");

  return NextResponse.json({ ok: true, selected: valid.size });
}
