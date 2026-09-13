/**
 * Connector contracts.
 *
 * Every connector has a live implementation and a fixture implementation that
 * satisfy the same interface. The evaluation suite swaps in deterministic
 * fixtures for ALL connectors while the real Anthropic agent + validators run.
 */

// ---- Exa (people/company enrichment) ----------------------------------------

export interface ExaCandidate {
  name: string;
  url?: string;
  exaId?: string;
  githubLogin?: string;
  companyDomain?: string;
  summary?: string;
  /** 0..1 relevance/identity score as reported/derived from Exa. */
  score: number;
}

export interface ExaConnector {
  readonly name: "exa";
  searchPeople(query: string, opts?: { limit?: number }): Promise<ExaCandidate[]>;
}

// ---- GitHub ------------------------------------------------------------------

export interface GithubUser {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  followers: number;
  publicRepos: number;
  createdAt: string;
  htmlUrl: string;
  type: "User" | "Organization";
}

export interface GithubRepo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  stars: number;
  forks: number;
  isFork: boolean;
  createdAt: string;
  pushedAt: string;
  htmlUrl: string;
  language: string | null;
  topics: string[];
}

export interface GithubRelease {
  tagName: string;
  name: string | null;
  publishedAt: string;
  htmlUrl: string;
}

export interface GithubContributor {
  login: string;
  contributions: number;
}

export interface GithubConnector {
  readonly name: "github";
  getUser(login: string): Promise<GithubUser | null>;
  listRepos(login: string, opts?: { limit?: number }): Promise<GithubRepo[]>;
  getRepo(owner: string, repo: string): Promise<GithubRepo | null>;
  listReleases(owner: string, repo: string): Promise<GithubRelease[]>;
  listContributors(owner: string, repo: string, opts?: { limit?: number }): Promise<GithubContributor[]>;
  /** Members of an org login (used to exclude org members from "external" contributors). */
  listOrgMembers(org: string): Promise<string[]>;
}

// ---- Web search + fetch ------------------------------------------------------

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedDate?: string;
}

export interface SearchResponse {
  query: string;
  provider: string;
  results: SearchResult[];
  /** True when the provider failed/was unavailable — signals must degrade, never invent. */
  degraded: boolean;
}

export interface SearchConnector {
  readonly name: "search";
  search(query: string, opts?: { limit?: number }): Promise<SearchResponse>;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  title: string | null;
  text: string;
  contentHash: string;
  blocked?: string; // reason a fetch was refused (SSRF/policy)
}

export interface FetchConnector {
  readonly name: "fetch";
  fetchPage(url: string): Promise<FetchedPage>;
}

// ---- Write connectors --------------------------------------------------------

export interface NotionConnector {
  readonly name: "notion";
  createFounderPage(input: {
    title: string;
    summary: string;
    opportunityScore: number;
    confidenceScore: number;
    label: string;
    properties?: Record<string, string>;
  }): Promise<{ pageId: string; url: string }>;
  appendTimeline(pageId: string, item: { date: string; text: string }): Promise<{ ok: true }>;
}

export interface SlackConnector {
  readonly name: "slack";
  createThread(channel: string, text: string): Promise<{ ts: string }>;
  postToThread(channel: string, threadTs: string, text: string): Promise<{ ts: string }>;
}

export interface GoogleConnector {
  readonly name: "google";
  createDoc(title: string, markdown: string): Promise<{ docId: string; url: string }>;
  sendGmail(input: { to: string; subject: string; body: string }): Promise<{ messageId: string }>;
}

// ---- Bundle ------------------------------------------------------------------

export interface Connectors {
  exa: ExaConnector;
  github: GithubConnector;
  search: SearchConnector;
  fetch: FetchConnector;
  notion: NotionConnector;
  slack: SlackConnector;
  google: GoogleConnector;
}
