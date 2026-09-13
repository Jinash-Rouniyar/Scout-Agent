import { NewRunForm } from "./NewRunForm";
import { Card, Eyebrow, PageTitle } from "@/components/ui";

const EXAMPLE_THESES = [
  "Pre-seed founders building developer infrastructure for AI agents, with meaningful open-source traction.",
  "Seed-stage companies making observability tooling for LLM applications.",
  "Early teams shipping open-source developer tools with fast-growing GitHub communities.",
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <Eyebrow>Thesis-driven sourcing</Eyebrow>
        <PageTitle sub="Describe your investment thesis. Scout finds 5–8 matching companies, then builds an evidence-backed diligence pack for the ones you pick — full memo, Notion record, Slack monitoring, and a weekly newsletter.">
          What are you looking to invest in?
        </PageTitle>
      </section>

      <Card shadow="lg" className="max-w-3xl">
        <NewRunForm examples={EXAMPLE_THESES} />
      </Card>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "1 · Discover",
            body: "Scout scans the market and returns a shortlist of companies that fit your thesis.",
          },
          {
            title: "2 · Select",
            body: "Pick the companies worth pursuing and choose delivery: Slack, newsletter, Notion.",
          },
          {
            title: "3 · Diligence",
            body: "Parallel research produces scored memos with facts, risks, and open questions.",
          },
        ].map((item) => (
          <div key={item.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <h3 className="text-sm font-semibold tracking-tight text-slate-900">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
