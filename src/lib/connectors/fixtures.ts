import type {
  Connectors,
  ExaCandidate,
  ExaConnector,
  FetchConnector,
  FetchedPage,
  GithubConnector,
  GithubContributor,
  GithubRelease,
  GithubRepo,
  GithubUser,
  GoogleConnector,
  NotionConnector,
  SearchConnector,
  SearchResponse,
  SlackConnector,
} from "./types";
import { contentHash, stableKey } from "@/lib/util/ids";

/**
 * Deterministic fixture data for the evaluation suite. Only connectors are
 * mocked; the real Anthropic agent + validators run against these responses.
 */
export interface FixtureSet {
  exaCandidates?: ExaCandidate[];
  github?: {
    users?: Record<string, GithubUser>;
    userRepos?: Record<string, GithubRepo[]>;
    repos?: Record<string, GithubRepo>; // "owner/repo"
    releases?: Record<string, GithubRelease[]>; // "owner/repo"
    contributors?: Record<string, GithubContributor[]>; // "owner/repo"
    orgMembers?: Record<string, string[]>;
    rateLimit?: boolean; // simulate 403 rate-limit failures
  };
  search?: SearchResponse | { degraded: true };
  pages?: Record<string, FetchedPage>;
}

/** Recording of every external write attempted through fixture write connectors. */
export interface WriteLog {
  app: string;
  method: string;
  args: unknown;
  externalId: string;
}

class FixtureExa implements ExaConnector {
  readonly name = "exa" as const;
  constructor(private set: FixtureSet) {}
  async searchPeople(): Promise<ExaCandidate[]> {
    return this.set.exaCandidates ?? [];
  }
}

class FixtureGithub implements GithubConnector {
  readonly name = "github" as const;
  constructor(private set: FixtureSet) {}
  private guard() {
    if (this.set.github?.rateLimit) throw new Error("github:rate-limit");
  }
  async getUser(login: string): Promise<GithubUser | null> {
    this.guard();
    return this.set.github?.users?.[login] ?? null;
  }
  async listRepos(login: string): Promise<GithubRepo[]> {
    this.guard();
    return this.set.github?.userRepos?.[login] ?? [];
  }
  async getRepo(owner: string, repo: string): Promise<GithubRepo | null> {
    this.guard();
    return this.set.github?.repos?.[`${owner}/${repo}`] ?? null;
  }
  async listReleases(owner: string, repo: string): Promise<GithubRelease[]> {
    this.guard();
    return this.set.github?.releases?.[`${owner}/${repo}`] ?? [];
  }
  async listContributors(owner: string, repo: string): Promise<GithubContributor[]> {
    this.guard();
    return this.set.github?.contributors?.[`${owner}/${repo}`] ?? [];
  }
  async listOrgMembers(org: string): Promise<string[]> {
    return this.set.github?.orgMembers?.[org] ?? [];
  }
}

class FixtureSearch implements SearchConnector {
  readonly name = "search" as const;
  constructor(private set: FixtureSet) {}
  async search(query: string): Promise<SearchResponse> {
    const s = this.set.search;
    if (!s) return { query, provider: "fixture", results: [], degraded: false };
    if ("degraded" in s && s.degraded) return { query, provider: "fixture", results: [], degraded: true };
    return { ...(s as SearchResponse), query };
  }
}

class FixtureFetch implements FetchConnector {
  readonly name = "fetch" as const;
  constructor(private set: FixtureSet) {}
  async fetchPage(url: string): Promise<FetchedPage> {
    const p = this.set.pages?.[url];
    if (p) return p;
    return { url, finalUrl: url, status: 404, title: null, text: "", contentHash: contentHash(url), blocked: "fixture-miss" };
  }
}

class FixtureNotion implements NotionConnector {
  readonly name = "notion" as const;
  constructor(private log: WriteLog[]) {}
  async createDiligenceRecord(input: any) {
    const pageId = `notion_${stableKey("page", input.title)}`;
    this.log.push({ app: "notion", method: "createDiligenceRecord", args: input, externalId: pageId });
    return { pageId, url: `https://notion.so/${pageId}` };
  }
  async createFounderPage(input: any) {
    const pageId = `notion_${stableKey("page", input.title)}`;
    this.log.push({ app: "notion", method: "createFounderPage", args: input, externalId: pageId });
    return { pageId, url: `https://notion.so/${pageId}` };
  }
  async appendTimeline(pageId: string, item: any) {
    this.log.push({ app: "notion", method: "appendTimeline", args: { pageId, item }, externalId: pageId });
    return { ok: true as const };
  }
}

class FixtureSlack implements SlackConnector {
  readonly name = "slack" as const;
  constructor(private log: WriteLog[]) {}
  async createThread(channel: string, text: string) {
    const ts = `slackts_${stableKey("thread", channel, text).slice(0, 12)}`;
    this.log.push({ app: "slack", method: "createThread", args: { channel, text }, externalId: ts });
    return { ts };
  }
  async postToThread(channel: string, threadTs: string, text: string) {
    const ts = `slackts_${stableKey("post", channel, threadTs, text).slice(0, 12)}`;
    this.log.push({ app: "slack", method: "postToThread", args: { channel, threadTs, text }, externalId: ts });
    return { ts };
  }
}

class FixtureGoogle implements GoogleConnector {
  readonly name = "google" as const;
  constructor(private log: WriteLog[]) {}
  async createDoc(title: string, markdown: string) {
    const docId = `doc_${stableKey("doc", title)}`;
    this.log.push({ app: "google", method: "createDoc", args: { title, markdown }, externalId: docId });
    return { docId, url: `https://docs.google.com/document/d/${docId}/edit` };
  }
  async replaceDoc(docId: string, markdown: string) {
    this.log.push({ app: "google", method: "replaceDoc", args: { docId, markdown }, externalId: docId });
    return { docId, url: `https://docs.google.com/document/d/${docId}/edit` };
  }
  async sendGmail(input: any) {
    const messageId = `gmail_${stableKey("gmail", input.to, input.subject).slice(0, 16)}`;
    this.log.push({ app: "google", method: "sendGmail", args: input, externalId: messageId });
    return { messageId };
  }
}

export function makeFixtureConnectors(set: FixtureSet): { connectors: Connectors; writes: WriteLog[] } {
  const writes: WriteLog[] = [];
  return {
    writes,
    connectors: {
      exa: new FixtureExa(set),
      github: new FixtureGithub(set),
      search: new FixtureSearch(set),
      fetch: new FixtureFetch(set),
      notion: new FixtureNotion(writes),
      slack: new FixtureSlack(writes),
      google: new FixtureGoogle(writes),
    },
  };
}
