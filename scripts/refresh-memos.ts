/**
 * Rewrite existing Google Docs with the formatted report layout.
 * Skips seed/demo placeholders. Run: npx tsx --env-file=.env scripts/refresh-memos.ts
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { claims, discoveredCompanies, dossiers, entities, scoutRuns } from "@/lib/db/schema";
import { LiveGoogleConnector } from "@/lib/connectors/google";
import { buildMemo } from "@/lib/core/writer";

function isLiveDocId(docId: string): boolean {
  return Boolean(docId) && !docId.startsWith("doc_");
}

async function main() {
  const google = new LiveGoogleConnector();
  const companies = await db.select().from(discoveredCompanies);
  const live = companies.filter((c) => c.docId && isLiveDocId(c.docId) && c.entityId);
  if (live.length === 0) {
    console.log("No live Google Docs to refresh.");
    return;
  }

  for (const company of live) {
    const [entity] = await db.select().from(entities).where(eq(entities.id, company.entityId!)).limit(1);
    const [dossier] = await db
      .select()
      .from(dossiers)
      .where(and(eq(dossiers.runId, company.runId), eq(dossiers.entityId, company.entityId!)))
      .limit(1);
    const [run] = await db.select().from(scoutRuns).where(eq(scoutRuns.id, company.runId)).limit(1);
    if (!entity || !dossier) {
      console.log("Skip (missing entity/dossier):", company.name, company.docId);
      continue;
    }
    const claimRows = await db
      .select()
      .from(claims)
      .where(and(eq(claims.runId, company.runId), eq(claims.entityId, company.entityId!)));
    const grouped: Record<string, string[]> = {};
    for (const c of claimRows) (grouped[c.category] ??= []).push(c.text);
    const memo = buildMemo(entity, dossier, grouped, run?.thesis);
    console.log("Refreshing", company.name, company.docId);
    await google.replaceDoc(company.docId!, memo);
    console.log("  OK", `https://docs.google.com/document/d/${company.docId}/edit`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
