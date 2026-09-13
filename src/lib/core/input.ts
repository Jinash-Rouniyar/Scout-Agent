import type { InputKind } from "@/lib/schemas";

const GITHUB_RE = /^https?:\/\/(www\.)?github\.com\/[^/\s]+/i;
const LINKEDIN_RE = /^https?:\/\/(www\.)?linkedin\.com\//i;
const PROFILE_HOSTS = /(linkedin\.com|twitter\.com|x\.com|angel\.co|wellfound\.com)/i;
const URL_RE = /^https?:\/\//i;

/**
 * Classify the supplied entity input. LinkedIn/other profile URLs are treated
 * as profile_url (identity context only — never fetched/scraped).
 */
export function detectInputKind(raw: string): InputKind {
  const input = raw.trim();
  if (GITHUB_RE.test(input)) return "github_url";
  if (LINKEDIN_RE.test(input) || (URL_RE.test(input) && PROFILE_HOSTS.test(input))) return "profile_url";
  if (URL_RE.test(input)) return "company_url";
  return "name";
}

export function extractGithubLogin(url: string): string | null {
  const m = url.match(/github\.com\/([^/\s?#]+)/i);
  if (!m) return null;
  const login = m[1];
  // Reserved GitHub paths that are not user/org logins.
  if (["orgs", "features", "about", "pricing", "sponsors"].includes(login.toLowerCase())) return null;
  return login;
}

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
