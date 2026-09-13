import { ALERT_THRESHOLD, type SignalKind } from "@/lib/schemas";

/** Deterministic event score per signal kind. Gates alerts before any model
 *  explanation. The model may explain a qualifying event but can NEVER promote a
 *  non-qualifying event above the threshold. */
export const SIGNAL_SCORES: Record<SignalKind, number> = {
  funding: 80,
  company_launch: 80,
  new_repo: 80,
  release: 70,
  star_growth: 60,
  contributors: 60,
  rss_launch: 60,
  web_launch: 60,
  noise: 0,
};

export function scoreSignal(kind: SignalKind): number {
  return SIGNAL_SCORES[kind];
}

export function isMaterial(kind: SignalKind): boolean {
  return SIGNAL_SCORES[kind] >= ALERT_THRESHOLD;
}

export { ALERT_THRESHOLD };

/** Deterministic launch-term classifier for RSS/site/web content. */
export const LAUNCH_TERMS = ["launch", "announce", "release", "beta", "ga", "raised", "funding", "seed"] as const;

export function detectLaunchTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return LAUNCH_TERMS.filter((term) => {
    // "ga" (general availability) must be an exact word to avoid matching
    // "game", "gather", etc. Other terms match common inflections.
    const re = term === "ga" ? /\bga\b/ : new RegExp(`\\b${term}(s|d|ed|ing)?\\b`);
    return re.test(lower);
  });
}
