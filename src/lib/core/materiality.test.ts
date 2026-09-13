import { describe, expect, it } from "vitest";
import { detectLaunchTerms, isMaterial, scoreSignal, ALERT_THRESHOLD } from "./materiality";

describe("materiality scoring", () => {
  it("assigns exact event scores", () => {
    expect(scoreSignal("funding")).toBe(80);
    expect(scoreSignal("company_launch")).toBe(80);
    expect(scoreSignal("new_repo")).toBe(80);
    expect(scoreSignal("release")).toBe(70);
    expect(scoreSignal("star_growth")).toBe(60);
    expect(scoreSignal("contributors")).toBe(60);
    expect(scoreSignal("rss_launch")).toBe(60);
    expect(scoreSignal("web_launch")).toBe(60);
    expect(scoreSignal("noise")).toBe(0);
  });

  it("alerts at threshold 60 and suppresses below", () => {
    expect(ALERT_THRESHOLD).toBe(60);
    expect(isMaterial("release")).toBe(true);
    expect(isMaterial("star_growth")).toBe(true);
    expect(isMaterial("noise")).toBe(false);
  });
});

describe("launch-term classifier", () => {
  it("detects eligible terms", () => {
    expect(detectLaunchTerms("We just announced our public beta launch")).toEqual(
      expect.arrayContaining(["announce", "beta", "launch"]),
    );
    expect(detectLaunchTerms("Seed round raised: $4M in funding")).toEqual(
      expect.arrayContaining(["seed", "raised", "funding"]),
    );
  });

  it("does not match unrelated text", () => {
    expect(detectLaunchTerms("A routine documentation update to the readme")).toEqual([]);
  });
});
