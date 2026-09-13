import { NextResponse } from "next/server";
import { buildRunSnapshot } from "@/lib/core/snapshot";

export const dynamic = "force-dynamic";

/** Polling-fallback + hydration snapshot. Assembled entirely from persisted state. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await buildRunSnapshot(id);
  if (!snapshot) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(snapshot);
}
