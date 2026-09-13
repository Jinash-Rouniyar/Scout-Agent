import { describe, expect, it } from "vitest";
import { resolveIdentity } from "./resolver";
import type { Connectors, ExaCandidate, GithubUser } from "@/lib/connectors/types";

function fakeConnectors(over: {
  exa?: ExaCandidate[];
  users?: Record<string, GithubUser>;
}): Connectors {
  return {
    exa: { name: "exa", async searchPeople() { return over.exa ?? []; } },
    github: {
      name: "github",
      async getUser(login: string) { return over.users?.[login] ?? null; },
      async listRepos() { return []; },
      async getRepo() { return null; },
      async listReleases() { return []; },
      async listContributors() { return []; },
      async listOrgMembers() { return []; },
    },
    search: { name: "search", async search(q) { return { query: q, provider: "fake", results: [], degraded: false }; } },
    fetch: { name: "fetch", async fetchPage(url) { return { url, finalUrl: url, status: 200, title: null, text: "", contentHash: "x" }; } },
    notion: { name: "notion", async createDiligenceRecord() { return { pageId: "p", url: "u" }; }, async createFounderPage() { return { pageId: "p", url: "u" }; }, async appendTimeline() { return { ok: true }; } },
    slack: { name: "slack", async createThread() { return { ts: "t" }; }, async postToThread() { return { ts: "t" }; } },
    google: { name: "google", async createDoc() { return { docId: "d", url: "u" }; }, async sendGmail() { return { messageId: "m" }; } },
  };
}

const user: GithubUser = {
  login: "octocat",
  name: "The Octocat",
  bio: null,
  company: null,
  blog: null,
  followers: 100,
  publicRepos: 8,
  createdAt: "2015-01-01T00:00:00Z",
  htmlUrl: "https://github.com/octocat",
  type: "User",
};

describe("entity resolution", () => {
  it("treats a direct GitHub URL as canonical (auto, confidence 1)", async () => {
    const c = fakeConnectors({ users: { octocat: user } });
    const d = await resolveIdentity("https://github.com/octocat", "github_url", c);
    expect(d.status).toBe("auto");
    if (d.status === "auto") {
      expect(d.entity.kind).toBe("person");
      expect(d.entity.githubLogin).toBe("octocat");
      expect(d.entity.identityConfidence).toBe(1);
    }
  });

  it("auto-links a name only at >=0.90 with a clear lead", async () => {
    const c = fakeConnectors({
      exa: [
        { name: "Jane Doe", score: 0.95, githubLogin: "janedoe" },
        { name: "Jane Doe (other)", score: 0.6 },
      ],
    });
    const d = await resolveIdentity("Jane Doe", "name", c);
    expect(d.status).toBe("auto");
  });

  it("requires confirmation when the top two are within 0.10", async () => {
    const c = fakeConnectors({
      exa: [
        { name: "John Smith A", score: 0.95, githubLogin: "smithA" },
        { name: "John Smith B", score: 0.9, githubLogin: "smithB" },
      ],
    });
    const d = await resolveIdentity("John Smith", "name", c);
    expect(d.status).toBe("needs_confirmation");
    // Never silently link a GitHub account when ambiguous.
    if (d.status === "needs_confirmation") expect(d.candidates.length).toBe(2);
  });

  it("requires confirmation when top confidence is below 0.90", async () => {
    const c = fakeConnectors({ exa: [{ name: "Ada", score: 0.7, githubLogin: "ada" }] });
    const d = await resolveIdentity("Ada", "name", c);
    expect(d.status).toBe("needs_confirmation");
  });

  it("never fetches a profile URL (identity context only)", async () => {
    let fetched = false;
    const c = fakeConnectors({ exa: [{ name: "Someone", score: 0.99 }] });
    c.fetch.fetchPage = async (url) => {
      fetched = true;
      return { url, finalUrl: url, status: 200, title: null, text: "", contentHash: "x" };
    };
    await resolveIdentity("https://linkedin.com/in/someone", "profile_url", c);
    expect(fetched).toBe(false);
  });
});
