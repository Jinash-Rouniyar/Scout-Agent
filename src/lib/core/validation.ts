import type { Claim } from "@/lib/schemas";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    total: number;
    facts: number;
    interpretations: number;
    risks: number;
    openQuestions: number;
    ungroundedFacts: number;
  };
}

/**
 * Deterministic grounding + schema validation.
 *
 * Hard rules (block publish):
 *  - Every FACT must cite >=1 stored source that exists in `sourceIds`.
 *  - Every claim's cited source ids must exist in the stored source set.
 *  - An OPEN_QUESTION must never be presented as a fact (enforced by category).
 *
 * Interpretations should point at facts/sources (warning if not); risks and
 * open questions may be uncited but are labeled by category.
 */
export function validateClaims(claims: Claim[], storedSourceIds: Set<string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let facts = 0;
  let interpretations = 0;
  let risks = 0;
  let openQuestions = 0;
  let ungroundedFacts = 0;

  for (const c of claims) {
    // Every cited id must correspond to a stored source.
    for (const sid of c.sourceIds) {
      if (!storedSourceIds.has(sid)) {
        errors.push(`Claim ${c.id} cites unknown source ${sid}`);
      }
    }

    switch (c.category) {
      case "fact": {
        facts++;
        const grounded = c.sourceIds.length > 0 && c.sourceIds.every((s) => storedSourceIds.has(s));
        if (!grounded) {
          ungroundedFacts++;
          errors.push(`Fact ${c.id} is not grounded in a stored source: "${c.text.slice(0, 80)}"`);
        }
        break;
      }
      case "interpretation": {
        interpretations++;
        if (c.sourceIds.length === 0) {
          warnings.push(`Interpretation ${c.id} does not point at any facts/sources`);
        }
        break;
      }
      case "risk":
        risks++;
        break;
      case "open_question":
        openQuestions++;
        break;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      total: claims.length,
      facts,
      interpretations,
      risks,
      openQuestions,
      ungroundedFacts,
    },
  };
}
