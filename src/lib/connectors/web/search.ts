import type { SearchConnector, SearchResponse } from "@/lib/connectors/types";
import { optionalEnv } from "@/env";

/**
 * Tavily-backed web search behind the SearchProvider interface. On any provider
 * failure the response is marked `degraded: true` with no results — callers must
 * degrade gracefully and never invent signals.
 */
export class TavilySearchConnector implements SearchConnector {
  readonly name = "search" as const;

  async search(query: string, opts?: { limit?: number }): Promise<SearchResponse> {
    const key = optionalEnv("TAVILY_API_KEY");
    if (!key) return { query, provider: "tavily", results: [], degraded: true };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          query,
          max_results: opts?.limit ?? 8,
          search_depth: "basic",
          include_answer: false,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) return { query, provider: "tavily", results: [], degraded: true };
      const data = (await res.json()) as {
        results?: Array<{ url: string; title?: string; content?: string; published_date?: string }>;
      };
      return {
        query,
        provider: "tavily",
        degraded: false,
        results: (data.results ?? []).map((r) => ({
          url: r.url,
          title: r.title ?? r.url,
          snippet: r.content ?? "",
          publishedDate: r.published_date,
        })),
      };
    } catch {
      return { query, provider: "tavily", results: [], degraded: true };
    }
  }
}
