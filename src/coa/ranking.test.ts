import { describe, expect, it } from "vitest";
import { rankCoas } from "./ranking";
import type { CoaCandidate } from "./types";

function candidate(
  id: string,
  status: CoaCandidate["status"],
  overall: number
): CoaCandidate {
  return {
    id,
    runId: "r",
    status,
    label: id,
    selectedActions: [],
    logisticsPlan: { kind: "empty", reason: "unsat" },
    scores: {
      feasibility: status === "sat" ? 1 : 0,
      logistics: 0.5,
      effects: 0.5,
      risk: 0.5,
      overall,
    },
  };
}

describe("rankCoas", () => {
  it("ranks SAT above insufficient_evidence above UNSAT", () => {
    const ranked = rankCoas([
      candidate("unsat", "unsat", 0),
      candidate("insuff", "insufficient_evidence", 0.3),
      candidate("sat", "sat", 0.8),
    ]);
    expect(ranked.map((c) => c.status)).toEqual([
      "sat",
      "insufficient_evidence",
      "unsat",
    ]);
  });

  it("never ranks UNSAT above SAT", () => {
    const ranked = rankCoas([
      candidate("u1", "unsat", 0.99),
      candidate("s1", "sat", 0.1),
      candidate("s2", "sat", 0.2),
    ]);
    const firstNonSat = ranked.findIndex((c) => c.status !== "sat");
    expect(ranked.slice(0, firstNonSat).every((c) => c.status === "sat")).toBe(true);
  });
});
