import { describe, expect, it } from "vitest";
import { computeConfidence, computeOpportunity, opportunityLabel, riskPenalty } from "./scoring";

describe("opportunity scoring", () => {
  it("weights factors 35/25/20/20 with no risk", () => {
    const r = computeOpportunity({ technical: 100, momentum: 100, thesisFit: 100, companyMarket: 100, verifiedRiskFacts: 0 });
    expect(r.base).toBe(100);
    expect(r.opportunity).toBe(100);
    expect(r.label).toBe("High conviction");
  });

  it("computes a mixed profile correctly", () => {
    // 0.35*75 + 0.25*50 + 0.20*75 + 0.20*50 = 26.25 + 12.5 + 15 + 10 = 63.75
    const r = computeOpportunity({ technical: 75, momentum: 50, thesisFit: 75, companyMarket: 50, verifiedRiskFacts: 0 });
    expect(r.base).toBeCloseTo(63.75, 2);
    expect(r.opportunity).toBe(64); // rounded
    expect(r.label).toBe("Watch");
  });

  it("applies -5 per verified risk fact, capped at -15", () => {
    expect(riskPenalty(0)).toBe(0);
    expect(riskPenalty(1)).toBe(5);
    expect(riskPenalty(3)).toBe(15);
    expect(riskPenalty(10)).toBe(15); // capped
  });

  it("subtracts risk penalty and clamps to [0,100]", () => {
    const r = computeOpportunity({ technical: 25, momentum: 0, thesisFit: 0, companyMarket: 0, verifiedRiskFacts: 5 });
    // base = 8.75, penalty capped 15 => clamp(round(8.75-15),0,100) = 0
    expect(r.opportunity).toBe(0);
    expect(r.riskPenalty).toBe(15);
  });

  it("labels by band", () => {
    expect(opportunityLabel(80)).toBe("High conviction");
    expect(opportunityLabel(79)).toBe("Promising");
    expect(opportunityLabel(65)).toBe("Promising");
    expect(opportunityLabel(64)).toBe("Watch");
    expect(opportunityLabel(45)).toBe("Watch");
    expect(opportunityLabel(44)).toBe("Low current conviction");
  });
});

describe("confidence scoring", () => {
  it("weights 40/30/20/10", () => {
    // 0.4*100 + 0.3*100 + 0.2*100 + 0.1*100 = 100
    expect(computeConfidence({ sourceQuality: 100, corroboration: 100, recency: 100, entityResolutionCertainty: 100 })).toBe(100);
    // 0.4*80 + 0.3*60 + 0.2*40 + 0.1*20 = 32 + 18 + 8 + 2 = 60
    expect(computeConfidence({ sourceQuality: 80, corroboration: 60, recency: 40, entityResolutionCertainty: 20 })).toBe(60);
  });
});
