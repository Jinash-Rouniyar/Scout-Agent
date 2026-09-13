import { describe, expect, it } from "vitest";
import { validateClaims } from "./validation";
import type { Claim } from "@/lib/schemas";

const stored = new Set(["src_a", "src_b"]);

describe("claim grounding validation", () => {
  it("passes when facts cite stored sources", () => {
    const claims: Claim[] = [
      { id: "c1", category: "fact", text: "Shipped repo", sourceIds: ["src_a"] },
      { id: "c2", category: "interpretation", text: "Strong builder", sourceIds: ["src_a"] },
      { id: "c3", category: "open_question", text: "Team size?", sourceIds: [] },
    ];
    const r = validateClaims(claims, stored);
    expect(r.ok).toBe(true);
    expect(r.stats.facts).toBe(1);
    expect(r.stats.openQuestions).toBe(1);
  });

  it("fails an ungrounded fact", () => {
    const claims: Claim[] = [{ id: "c1", category: "fact", text: "Raised $10M", sourceIds: [] }];
    const r = validateClaims(claims, stored);
    expect(r.ok).toBe(false);
    expect(r.stats.ungroundedFacts).toBe(1);
  });

  it("fails a fact citing an unknown source", () => {
    const claims: Claim[] = [{ id: "c1", category: "fact", text: "x", sourceIds: ["src_missing"] }];
    const r = validateClaims(claims, stored);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("unknown source"))).toBe(true);
  });

  it("allows uncited risks and open questions", () => {
    const claims: Claim[] = [
      { id: "c1", category: "risk", text: "Abandoned flagship", sourceIds: ["src_b"] },
      { id: "c2", category: "open_question", text: "Revenue?", sourceIds: [] },
    ];
    const r = validateClaims(claims, stored);
    expect(r.ok).toBe(true);
  });
});
