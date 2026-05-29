import { describe, expect, it } from "vitest";
import { buildLogisticsMatrixDerivation } from "./matrixDerivation";
import type { CoaCandidate } from "./types";

function makeCandidate(overrides: Partial<CoaCandidate> = {}): CoaCandidate {
  return {
    id: "coa_test",
    runId: "run_test",
    status: "sat",
    label: "COA 1",
    selectedActions: [],
    logisticsPlan: {
      kind: "populated",
      source: "validated-intel",
      coaId: "coa_test",
      totalDuration: 240,
      lanes: [
        { id: "lane-drone", label: "drone-d7", chipIds: ["chip-a", "chip-b"] },
        { id: "lane-fusion", label: "data-fusion-cell", chipIds: ["chip-c"] },
      ],
      chips: [
        {
          id: "chip-a",
          actionId: "a1",
          label: "ISR orbit A",
          laneId: "lane-drone",
          startOffset: 0,
          duration: 60,
          dependencies: [],
          linkedFactIds: ["fact_uas_001"],
        },
        {
          id: "chip-b",
          actionId: "a2",
          label: "ISR orbit B",
          laneId: "lane-drone",
          startOffset: 60,
          duration: 60,
          dependencies: ["chip-a"],
          linkedFactIds: ["fact_radar_001"],
        },
        {
          id: "chip-c",
          actionId: "a1",
          label: "Fusion support",
          laneId: "lane-fusion",
          startOffset: 0,
          duration: 60,
          dependencies: [],
          linkedFactIds: ["fact_uas_001"],
        },
      ],
    },
    scores: {
      feasibility: 1,
      logistics: 0.72,
      effects: 0.5,
      risk: 0.3,
      overall: 0.65,
    },
    ...overrides,
  };
}

describe("buildLogisticsMatrixDerivation", () => {
  it("includes lane, chip, and fact provenance in derivedFrom", () => {
    const derivation = buildLogisticsMatrixDerivation(makeCandidate());
    expect(derivation.derivedFrom).toContain("chip-a");
    expect(derivation.derivedFrom).toContain("lane-drone");
    expect(derivation.derivedFrom).toContain("fact:fact_uas_001");
    expect(derivation.derivedFrom).toContain("scores.logistics");
  });

  it("names lanes, chips, facts, and dependencies in the explanation", () => {
    const derivation = buildLogisticsMatrixDerivation(makeCandidate());
    expect(derivation.explanation).toContain("drone-d7");
    expect(derivation.explanation).toContain("fact_uas_001");
    expect(derivation.explanation).toContain("Dependencies: 1");
    expect(derivation.explanation).toContain("3 action chip");
  });
});
