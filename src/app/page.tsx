import { NewRunForm } from "./NewRunForm";
import { Card } from "@/components/ui";

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Who or what are you diligencing?</h1>
        <p className="mt-2 text-sm text-muted">
          Scout deeply researches one person or company you supply, backs every fact with a stored
          source, and keeps watching after you add them to your watchlist.
        </p>
      </div>

      <Card>
        <NewRunForm />
      </Card>

      <div className="mt-6 grid grid-cols-3 gap-3 text-xs text-muted">
        <div className="rounded-lg border border-border bg-panel2 p-3">
          Paste a <span className="text-text">GitHub URL</span>, company website, profile link, or name.
        </div>
        <div className="rounded-lg border border-border bg-panel2 p-3">
          A LinkedIn URL is <span className="text-text">identity context only</span> — Scout never
          scrapes it.
        </div>
        <div className="rounded-lg border border-border bg-panel2 p-3">
          Every claim is separated into <span className="text-text">fact, interpretation, risk, and open
          question</span>.
        </div>
      </div>
    </div>
  );
}
