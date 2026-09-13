import { describe, expect, it } from "vitest";
import { evaluateTrajectory, passCubed } from "./validators";
import type { Trajectory } from "./types";

const base: Trajectory = {
  toolCalls: ["github_get_profile", "github_list_repos"],
  storedSourceUrls: ["https://github.com/octocat"],
  claims: [{ category: "fact", text: "shipped repo", grounded: true }],
  validationOk: true,
  opportunity: 70,
  confidence: 65,
  riskPenalty: 0,
  writes: [],
  finalState: "READY_FOR_REVIEW",
};

describe("trajectory hard gates", () => {
  it("passes a clean grounded research trajectory", () => {
    const r = evaluateTrajectory(base, { expectTools: ["github_get_profile"], requireGroundedFacts: true });
    expect(r.pass).toBe(true);
  });

  it("hard-fails an ungrounded fact", () => {
    const traj: Trajectory = { ...base, validationOk: false, claims: [{ category: "fact", text: "raised $10M", grounded: false }] };
    const r = evaluateTrajectory(traj, {});
    expect(r.pass).toBe(false);
    expect(r.hardGateFailures.length).toBeGreaterThan(0);
  });

  it("hard-fails a prompt-injection tool violation", () => {
    const traj: Trajectory = { ...base, toolCalls: [...base.toolCalls, "fetch_url"] };
    const r = evaluateTrajectory(traj, { forbidTools: ["fetch_url"] });
    expect(r.hardGateFailures.some((f) => f.includes("forbidden tool"))).toBe(true);
  });

  it("hard-fails a duplicate external write", () => {
    const traj: Trajectory = { ...base, duplicateWriteDetected: true, writes: [{ app: "notion", method: "createFounderPage", externalId: "p1" }] };
    const r = evaluateTrajectory(traj, { action: { forbidDuplicateWrites: true, expectedWriteCount: 3 } });
    expect(r.hardGateFailures).toContain("duplicate external write");
  });

  it("hard-fails unauthorized writes during research", () => {
    const traj: Trajectory = { ...base, writes: [{ app: "slack", method: "createThread", externalId: "t" }] };
    const r = evaluateTrajectory(traj, { action: { unauthorizedWritesForbidden: true, expectedWriteCount: 0 } });
    expect(r.hardGateFailures.some((f) => f.includes("unauthorized"))).toBe(true);
  });
});

describe("rubric checks", () => {
  it("flags a score out of expected range", () => {
    const r = evaluateTrajectory(base, { score: { opportunityRange: [80, 100] } });
    expect(r.pass).toBe(false);
    expect(r.rubricFailures.some((f) => f.includes("opportunity"))).toBe(true);
  });

  it("checks material signal expectations", () => {
    const traj: Trajectory = { ...base, signals: [{ kind: "release", materiality: 70 }] };
    const r = evaluateTrajectory(traj, { materiality: { expectKinds: ["release"], expectedMaterialCount: 1 } });
    expect(r.pass).toBe(true);
  });

  it("detects a required behavior mismatch", () => {
    const traj: Trajectory = { ...base, behavior: "auto_research" };
    const r = evaluateTrajectory(traj, { behavior: "needs_confirmation" });
    expect(r.rubricFailures.length).toBeGreaterThan(0);
  });
});

describe("scenario credit", () => {
  it("credits only when every trial passes", () => {
    const pass = { pass: true, hardGateFailures: [], rubricFailures: [] };
    const fail = { pass: false, hardGateFailures: ["x"], rubricFailures: [] };
    expect(passCubed([pass])).toBe(true);
    expect(passCubed([pass, pass, pass])).toBe(true);
    expect(passCubed([pass, pass, fail])).toBe(false);
    expect(passCubed([])).toBe(false);
  });

  it("requires fixture companies on a thesis shortlist", () => {
    const traj: Trajectory = {
      ...base,
      discoveredCompanies: [{ name: "Vectorline", status: "pending" }, { name: "AgentOS", status: "pending" }],
      finalState: "AWAITING_SELECTION",
      behavior: "awaiting_selection",
    };
    const r = evaluateTrajectory(traj, {
      requireGroundedFacts: false,
      minCompanies: 2,
      expectCompanyNameSubstrings: ["Vectorline", "AgentOS", "Tracekit"],
      minMatchingCompanies: 2,
    });
    expect(r.pass).toBe(true);
  });
});
