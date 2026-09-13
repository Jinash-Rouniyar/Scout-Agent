import type {
  GithubConnector,
  GithubContributor,
  GithubRelease,
  GithubRepo,
  GithubUser,
} from "./types";
import { optionalEnv } from "@/env";

const API = "https://api.github.com";

/**
 * GitHub read connector over the public REST API. Uses GITHUB_TOKEN when present
 * (higher rate limits). On rate-limit/failure it throws a typed error so callers
 * can mark GitHub evidence unavailable rather than inventing it.
 */
export class LiveGithubConnector implements GithubConnector {
  readonly name = "github" as const;

  private async req<T>(path: string): Promise<T | null> {
    const token = optionalEnv("GITHUB_TOKEN");
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "ScoutBot/0.1",
      "x-github-api-version": "2022-11-28",
    };
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await fetch(`${API}${path}`, { headers });
    if (res.status === 404) return null;
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("github:rate-limit");
    }
    if (!res.ok) throw new Error(`github:${res.status}`);
    return (await res.json()) as T;
  }

  async getUser(login: string): Promise<GithubUser | null> {
    const u = await this.req<any>(`/users/${encodeURIComponent(login)}`);
    if (!u) return null;
    return {
      login: u.login,
      name: u.name ?? null,
      bio: u.bio ?? null,
      company: u.company ?? null,
      blog: u.blog ?? null,
      followers: u.followers ?? 0,
      publicRepos: u.public_repos ?? 0,
      createdAt: u.created_at,
      htmlUrl: u.html_url,
      type: u.type === "Organization" ? "Organization" : "User",
    };
  }

  private mapRepo(r: any): GithubRepo {
    return {
      fullName: r.full_name,
      name: r.name,
      owner: r.owner?.login ?? r.full_name?.split("/")[0],
      description: r.description ?? null,
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      isFork: Boolean(r.fork),
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
      htmlUrl: r.html_url,
      language: r.language ?? null,
      topics: r.topics ?? [],
    };
  }

  async listRepos(login: string, opts?: { limit?: number }): Promise<GithubRepo[]> {
    const limit = opts?.limit ?? 30;
    const repos = await this.req<any[]>(`/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=${limit}`);
    return (repos ?? []).map((r) => this.mapRepo(r));
  }

  async getRepo(owner: string, repo: string): Promise<GithubRepo | null> {
    const r = await this.req<any>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    return r ? this.mapRepo(r) : null;
  }

  async listReleases(owner: string, repo: string): Promise<GithubRelease[]> {
    const rels = await this.req<any[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=20`);
    return (rels ?? []).map((r) => ({
      tagName: r.tag_name,
      name: r.name ?? null,
      publishedAt: r.published_at,
      htmlUrl: r.html_url,
    }));
  }

  async listContributors(owner: string, repo: string, opts?: { limit?: number }): Promise<GithubContributor[]> {
    const limit = opts?.limit ?? 30;
    const cs = await this.req<any[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?per_page=${limit}`);
    return (cs ?? []).map((c) => ({ login: c.login, contributions: c.contributions ?? 0 }));
  }

  async listOrgMembers(org: string): Promise<string[]> {
    const ms = await this.req<any[]>(`/orgs/${encodeURIComponent(org)}/members?per_page=100`).catch(() => []);
    return (ms ?? []).map((m) => m.login);
  }
}
