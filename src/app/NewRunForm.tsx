"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function NewRunForm() {
  const router = useRouter();
  const [input, setInput] = useState("");
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
        body: JSON.stringify({ input, thesis: thesis || undefined }),
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
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-muted">Entity</label>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          required
          placeholder="GitHub URL, company website, profile link, or name"
          className="w-full rounded-lg border border-border bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-muted">
          Investment lens (optional)
        </label>
        <input
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          placeholder="AI infrastructure, early stage, open-source traction"
          className="w-full rounded-lg border border-border bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={loading || !input.trim()}>
          {loading ? "Starting…" : "Start Scout"}
        </Button>
      </div>
    </form>
  );
}
