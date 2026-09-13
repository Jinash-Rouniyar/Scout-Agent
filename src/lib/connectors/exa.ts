import Exa from "exa-js";
import type { ExaCandidate, ExaConnector } from "./types";
import { optionalEnv } from "@/env";
import { extractGithubLogin, extractDomain } from "@/lib/core/input";

/**
 * Exa-backed people/company enrichment. Exa provides LinkedIn-like professional
 * data WITHOUT scraping LinkedIn. Used only for name-only inputs to produce up
 * to N identity candidates; direct GitHub/company URLs never need Exa.
 */
export class LiveExaConnector implements ExaConnector {
  readonly name = "exa" as const;

  async searchPeople(query: string, opts?: { limit?: number }): Promise<ExaCandidate[]> {
    const key = optionalEnv("EXA_API_KEY");
    if (!key) return [];
    const exa = new Exa(key);
    const limit = opts?.limit ?? 3;

    const res = await exa.searchAndContents(query, {
      numResults: Math.max(limit, 5),
      type: "auto",
      category: "linkedin profile",
      text: { maxCharacters: 800 },
    } as any).catch(() => null);

    if (!res || !("results" in res)) return [];

    return (res.results as any[]).slice(0, Math.max(limit, 5)).map((r, i) => {
      const url: string | undefined = r.url;
      const summary: string = r.text ?? r.summary ?? "";
      const githubLogin = url && /github\.com/i.test(url) ? extractGithubLogin(url) ?? undefined : undefined;
      const companyDomain = url && !/linkedin\.com|github\.com/i.test(url) ? extractDomain(url) ?? undefined : undefined;
      // Exa returns a relevance score; normalize to 0..1 and decay by rank as a proxy.
      const rawScore = typeof r.score === "number" ? r.score : 0.7 - i * 0.05;
      return {
        name: r.title ?? r.author ?? query,
        url,
        exaId: r.id,
        githubLogin,
        companyDomain,
        summary: summary.slice(0, 500),
        score: Math.max(0, Math.min(1, rawScore)),
      } satisfies ExaCandidate;
    });
  }
}
