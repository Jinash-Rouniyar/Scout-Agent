import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scoutRuns, identityCandidates } from "@/lib/db/schema";
import { createEntity } from "@/lib/core/pipeline";
import { emit } from "@/lib/core/events";
import type { EntityDraft } from "@/lib/core/resolver";

export const dynamic = "force-dynamic";

const Body = z.object({ candidateId: z.string() });

/**
 * Confirm an ambiguous identity by explicitly choosing one candidate. Only
 * after this does Scout link a person to a GitHub account. Re-call
 * /execute afterwards to continue research.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, runId)).limit(1);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.entityId) return NextResponse.json({ error: "identity already confirmed" }, { status: 409 });

  const [cand] = await db
    .select()
    .from(identityCandidates)
    .where(eq(identityCandidates.id, body.candidateId))
    .limit(1);
  if (!cand || cand.runId !== runId) return NextResponse.json({ error: "candidate not found" }, { status: 404 });

  const draft: EntityDraft = {
    kind: cand.companyDomain && !cand.githubLogin ? "company" : "person",
    canonicalName: cand.name,
    exaId: cand.exaId ?? undefined,
    githubLogin: cand.githubLogin ?? undefined,
    linkedGithubAccounts: cand.githubLogin ? [cand.githubLogin] : [],
    companyDomain: cand.companyDomain ?? undefined,
    profileUrl: (run.inputKind === "profile_url" ? run.input : undefined) ?? undefined,
    identityConfidence: cand.confidence,
  };

  const entityId = await createEntity(runId, draft);
  await emit(runId, "identity.confirmed", { entityId, auto: false, candidateId: cand.id, confidence: cand.confidence });

  return NextResponse.json({ ok: true, entityId });
}
