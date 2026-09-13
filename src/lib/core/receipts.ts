import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { actionReceipts } from "@/lib/db/schema";
import { id, stableKey } from "@/lib/util/ids";
import type { ActionType } from "@/lib/schemas";

export interface ReceiptScope {
  actionType: ActionType;
  targetApp: "notion" | "slack" | "google_docs" | "gmail";
  entityId?: string;
  /** period (weekly recap) or event id (monitoring) participating in the key */
  scopeKey?: string;
}

export interface ReceiptResult {
  externalObjectId: string;
  /** true when the write was skipped because a prior successful receipt existed */
  reused: boolean;
  result: "success" | "failed";
  error?: string;
}

function computeKey(scope: ReceiptScope): string {
  return stableKey(scope.targetApp, scope.actionType, scope.entityId ?? "", scope.scopeKey ?? "");
}

/**
 * action_receipts is the single idempotency authority for ALL external writes
 * (Slack/Notion/Docs/Gmail have no generic idempotency-key API).
 *
 * Pattern:
 *   1. create the unique receipt row (idempotencyKey) if absent
 *   2. call the external API ONLY if the receipt has no external_object_id
 *   3. persist the returned id (Slack ts/thread_ts, Notion page id, Doc id, Gmail message id)
 *
 * A second execution reuses the stored external_object_id instead of writing
 * again — preventing duplicates even if a cron event fires twice.
 */
export async function withReceipt(
  scope: ReceiptScope,
  write: () => Promise<{ externalObjectId: string }>,
): Promise<ReceiptResult> {
  const idempotencyKey = computeKey(scope);

  // Step 1: ensure a receipt row exists (unique on idempotencyKey).
  await db
    .insert(actionReceipts)
    .values({
      id: id("rcpt"),
      actionType: scope.actionType,
      targetApp: scope.targetApp,
      entityId: scope.entityId,
      scopeKey: scope.scopeKey,
      idempotencyKey,
      result: "pending",
      attemptCount: 0,
    })
    .onConflictDoNothing({ target: actionReceipts.idempotencyKey });

  const [receipt] = await db.select().from(actionReceipts).where(eq(actionReceipts.idempotencyKey, idempotencyKey)).limit(1);

  // Step 2: if already written successfully, reuse — never write twice.
  if (receipt.externalObjectId && receipt.result === "success") {
    return { externalObjectId: receipt.externalObjectId, reused: true, result: "success" };
  }

  // Step 3: perform the write and persist the external id.
  try {
    const { externalObjectId } = await write();
    await db
      .update(actionReceipts)
      .set({ externalObjectId, result: "success", attemptCount: receipt.attemptCount + 1, error: null, updatedAt: new Date() })
      .where(eq(actionReceipts.idempotencyKey, idempotencyKey));
    return { externalObjectId, reused: false, result: "success" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "write-failed";
    await db
      .update(actionReceipts)
      .set({ result: "failed", attemptCount: receipt.attemptCount + 1, error: message, updatedAt: new Date() })
      .where(eq(actionReceipts.idempotencyKey, idempotencyKey));
    return { externalObjectId: "", reused: false, result: "failed", error: message };
  }
}

/** Read a prior successful external id for a scope, if any (e.g. the Slack
 *  thread ts / Notion page id to reuse for follow-up writes). */
export async function findExternalId(scope: ReceiptScope): Promise<string | null> {
  const [receipt] = await db
    .select()
    .from(actionReceipts)
    .where(eq(actionReceipts.idempotencyKey, computeKey(scope)))
    .limit(1);
  return receipt?.externalObjectId ?? null;
}
