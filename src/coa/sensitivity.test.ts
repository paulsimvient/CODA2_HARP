import { describe, expect, it } from "vitest";
import { analyzeRankingSensitivity } from "./sensitivity";
import type { CoaCandidate } from "./types";

function satCoa(
  id: string,
  label: string,
  overall: number,
  risk: number,
  logistics: number
): CoaCandidate {
  return {
    id,
    runId: "run_test",
    status: "sat",
    label,
    selectedActions: [
      {
        id: `a-${id}`,
        name: label,
        type: "cyber",
        startTime: 0,
        duration: 100,
        resources: ["r1"],
      },
    ],
    logisticsPlan: { kind: "empty", reason: "not-built" },
    scores: {
      feasibility: 1,
      logistics,
      effects: overall,
      risk,
      overall,
    },
  };
}

describe("analyzeRankingSensitivity", () => {
  it("reports high confidence when leader is well separated", () => {
    const result = analyzeRankingSensitivity([
      satCoa("c1", "COA 1", 0.82, 0.2, 0.7),
      satCoa("c2", "COA 2", 0.55, 0.5, 0.5),
    ]);
    expect(result.confidence).toBe("high");
    expect(result.fragilePairs).toHaveLength(0);
  });

  it("flags fragile ranking when top two COAs are close", () => {
    const result = analyzeRankingSensitivity([
      satCoa("c1", "COA 1", 0.62, 0.45, 0.55),
      satCoa("c2", "COA 2", 0.6, 0.25, 0.7),
    ]);
    expect(["low", "medium"]).toContain(result.confidence);
    expect(result.reason.length).toBeGreaterThan(10);
  });
});
