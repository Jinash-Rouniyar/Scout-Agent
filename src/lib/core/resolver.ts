import type { Connectors, ExaCandidate } from "@/lib/connectors/types";
import type { InputKind } from "@/lib/schemas";
import { extractDomain, extractGithubLogin } from "./input";

export interface EntityDraft {
  kind: "person" | "company";
  canonicalName: string;
  exaId?: string;
  githubLogin?: string;
  linkedGithubAccounts?: string[];
  companyDomain?: string;
  companyGithubOrg?: string;
  companyRepos?: string[];
  profileUrl?: string;
  identityConfidence: number;
}

export interface ResolveCandidate {
  rank: number;
  name: string;
  exaId?: string;
  githubLogin?: string;
  companyDomain?: string;
  confidence: number;
  summary?: string;
  raw?: unknown;
}

export type ResolveDecision =
  | { status: "auto"; entity: EntityDraft }
  | { status: "needs_confirmation"; candidates: ResolveCandidate[]; reason: string; profileUrl?: string };

/** Confidence gate: auto-link only when >= 0.90 and the lead is unambiguous. */
export const AUTO_LINK_CONFIDENCE = 0.9;
export const AMBIGUITY_GAP = 0.1;

/**
 * Resolve the supplied input to a confirmed entity, or return candidates for
 * explicit user confirmation.
 *
 * - Direct GitHub/company URLs are canonical (confidence 1.0).
 * - Name/profile inputs use Exa; auto-link only at >=0.90 with a clear lead.
 * - A person is NEVER silently associated with a GitHub account when ambiguous.
 * - LinkedIn/profile URLs are identity context only and are never fetched.
 */
export async function resolveIdentity(
  input: string,
  inputKind: InputKind,
  connectors: Connectors,
): Promise<ResolveDecision> {
  if (inputKind === "github_url") {
    return resolveGithubUrl(input, connectors);
  }
  if (inputKind === "company_url") {
    return resolveCompanyUrl(input, connectors);
  }
  // name or profile_url -> Exa
  return resolveViaExa(input, inputKind, connectors);
}

async function resolveGithubUrl(url: string, connectors: Connectors): Promise<ResolveDecision> {
  const login = extractGithubLogin(url);
  if (!login) {
    return { status: "needs_confirmation", candidates: [], reason: "Could not parse a GitHub login from the URL." };
  }
  const user = await connectors.github.getUser(login);
  if (!user) {
    return { status: "needs_confirmation", candidates: [], reason: `GitHub account @${login} not found.` };
  }
  if (user.type === "Organization") {
    return {
      status: "auto",
      entity: {
        kind: "company",
        canonicalName: user.name ?? user.login,
        companyGithubOrg: user.login,
        companyDomain: user.blog ? extractDomain(user.blog) ?? undefined : undefined,
        identityConfidence: 1,
      },
    };
  }
  return {
    status: "auto",
    entity: {
      kind: "person",
      canonicalName: user.name ?? user.login,
      githubLogin: user.login,
      linkedGithubAccounts: [user.login],
      companyDomain: user.company ? undefined : undefined,
      identityConfidence: 1,
    },
  };
}

async function resolveCompanyUrl(url: string, connectors: Connectors): Promise<ResolveDecision> {
  const domain = extractDomain(url);
  if (!domain) {
    return { status: "needs_confirmation", candidates: [], reason: "Could not parse a domain from the URL." };
  }
  // Company by domain is canonical. A GitHub org is linked ONLY via a verified
  // signal (org linked from site OR domain linked from org). Name similarity is
  // never sufficient.
  const verifiedOrg = await verifyCompanyGithub(url, domain, connectors);
  return {
    status: "auto",
    entity: {
      kind: "company",
      canonicalName: domain,
      companyDomain: domain,
      companyGithubOrg: verifiedOrg ?? undefined,
      identityConfidence: 1,
    },
  };
}

/** Verified company->GitHub ownership: org linked from the site, or site domain
 * declared on the GitHub org. Returns the org login or null. */
async function verifyCompanyGithub(url: string, domain: string, connectors: Connectors): Promise<string | null> {
  const page = await connectors.fetch.fetchPage(url).catch(() => null);
  if (!page || page.blocked) return null;

  // Candidate orgs = github.com/<org> links found on the company site.
  const orgMatches = [...page.text.matchAll(/github\.com\/([A-Za-z0-9-]+)/g)].map((m) => m[1]);
  const uniqueOrgs = [...new Set(orgMatches)].filter(
    (o) => !["features", "about", "pricing", "sponsors", "orgs"].includes(o.toLowerCase()),
  );

  for (const org of uniqueOrgs.slice(0, 5)) {
    const gh = await connectors.github.getUser(org).catch(() => null);
    if (!gh) continue;
    if (gh.type === "Organization") {
      // Signal 1: org is linked from the company site (already true here).
      return org;
    }
  }

  // Signal 2: a GitHub org whose declared blog is this domain.
  // (Only checked if the site linked exactly one github handle that is a user.)
  for (const org of uniqueOrgs.slice(0, 5)) {
    const gh = await connectors.github.getUser(org).catch(() => null);
    if (gh?.blog && extractDomain(gh.blog) === domain) return gh.login;
  }
  return null;
}

async function resolveViaExa(
  input: string,
  inputKind: InputKind,
  connectors: Connectors,
): Promise<ResolveDecision> {
  const profileUrl = inputKind === "profile_url" ? input : undefined;
  const query = input;
  const raw = await connectors.exa.searchPeople(query, { limit: 3 }).catch(() => [] as ExaCandidate[]);
  const candidates = raw
    .slice(0, 3)
    .map((c, i) => ({
      rank: i + 1,
      name: c.name,
      exaId: c.exaId,
      githubLogin: c.githubLogin,
      companyDomain: c.companyDomain,
      confidence: c.score,
      summary: c.summary,
      raw: c,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  if (candidates.length === 0) {
    return {
      status: "needs_confirmation",
      candidates: [],
      reason: "No professional profiles found. Confirm the entity or provide a GitHub/company URL.",
      profileUrl,
    };
  }

  const top = candidates[0];
  const gap = candidates.length > 1 ? top.confidence - candidates[1].confidence : 1;

  if (top.confidence >= AUTO_LINK_CONFIDENCE && gap >= AMBIGUITY_GAP) {
    return {
      status: "auto",
      entity: {
        kind: "person",
        canonicalName: top.name,
        exaId: top.exaId,
        // Only link a GitHub account when the identity itself is unambiguous.
        githubLogin: top.githubLogin,
        linkedGithubAccounts: top.githubLogin ? [top.githubLogin] : [],
        companyDomain: top.companyDomain,
        profileUrl,
        identityConfidence: top.confidence,
      },
    };
  }

  return {
    status: "needs_confirmation",
    candidates,
    reason:
      top.confidence < AUTO_LINK_CONFIDENCE
        ? `Top match confidence ${top.confidence.toFixed(2)} is below the ${AUTO_LINK_CONFIDENCE} auto-link threshold.`
        : `Top two matches are within ${AMBIGUITY_GAP} confidence — ambiguous.`,
    profileUrl,
  };
}
