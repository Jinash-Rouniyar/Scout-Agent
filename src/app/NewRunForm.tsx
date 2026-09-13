"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Label } from "@/components/ui";

export function NewRunForm({ examples = [] }: { examples?: string[] }) {
  const router = useRouter();
  const [thesis, setThesis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thesis }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create run");
      const { id } = await res.json();
      router.push(`/runs/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <Label>Investment thesis</Label>
        <textarea
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          required
          rows={3}
          placeholder="e.g. Pre-seed founders building developer infrastructure for AI agents, with meaningful open-source traction."
          className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        />
      </div>

      {examples.length ? (
        <div className="flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setThesis(ex)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-600 transition hover:border-slate-300 hover:bg-white"
            >
              {ex.length > 64 ? `${ex.slice(0, 61)}…` : ex}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={loading || !thesis.trim()}>
          {loading ? "Starting…" : "Discover companies"}
        </Button>
      </div>
    </form>
  );
}
