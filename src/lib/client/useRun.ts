"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSnapshot } from "@/lib/core/snapshot";

const DRIVABLE = new Set(["CREATED", "FAILED_RETRYABLE", "REVIEW_NEEDED", "RESEARCHING", "CREATING_DILIGENCE_PACK"]);

/**
 * Run view model.
 *
 * - Structured state comes from the persisted snapshot (GET /api/runs/:id), so
 *   the UI rebuilds correctly from history after a refresh.
 * - Live updates arrive via EventSource on /events (Last-Event-ID replay handled
 *   by the browser + server).
 * - If SSE is not open, a 3s polling fallback keeps the snapshot fresh.
 * - Execution is driven by a background fetch to /execute (resumable + durable).
 */
export function useRun(runId: string) {
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const drivingRef = useRef(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (res.ok) setSnapshot(await res.json());
    } catch {
      /* transient */
    }
  }, [runId]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void refetch();
    }, 400);
  }, [refetch]);

  const drive = useCallback(async () => {
    if (drivingRef.current) return;
    drivingRef.current = true;
    try {
      const res = await fetch(`/api/runs/${runId}/execute`, { cache: "no-store" });
      const reader = res.body?.getReader();
      // Consume the driver stream to keep the serverless function alive.
      if (reader) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch {
      /* the run remains durable; user can retry */
    } finally {
      drivingRef.current = false;
      void refetch();
    }
  }, [runId, refetch]);

  // Initial load + decide whether to drive.
  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (!res.ok) {
        setError("Run not found");
        return;
      }
      const snap: RunSnapshot = await res.json();
      if (!active) return;
      setSnapshot(snap);
      if (DRIVABLE.has(snap.run.state)) void drive();
    })();
    return () => {
      active = false;
    };
  }, [runId, drive]);

  // Live SSE stream.
  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/events`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onmessage = () => scheduleRefetch();
    // Named events also trigger a refetch.
    for (const t of [
      "state.changed",
      "identity.candidates",
      "identity.confirmed",
      "source.stored",
      "claim.added",
      "synthesis.completed",
      "dossier.ready",
      "action.receipt",
      "signal.detected",
      "stream.settled",
      "run.error",
    ]) {
      es.addEventListener(t, () => scheduleRefetch());
    }
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [runId, scheduleRefetch]);

  // Polling fallback: only active while SSE is not open.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!connected) void refetch();
    }, 3000);
    return () => clearInterval(interval);
  }, [connected, refetch]);

  const confirm = useCallback(
    async (candidateId: string) => {
      const res = await fetch(`/api/runs/${runId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (res.ok) {
        await refetch();
        void drive(); // continue into research
      } else {
        setError((await res.json()).error ?? "Failed to confirm");
      }
    },
    [runId, refetch, drive],
  );

  const approve = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}/approve`, { method: "POST" });
    if (res.ok) {
      await refetch();
      void drive();
    } else {
      setError((await res.json()).error ?? "Failed to approve");
    }
  }, [runId, refetch, drive]);

  return { snapshot, connected, error, confirm, approve, refetch };
}
