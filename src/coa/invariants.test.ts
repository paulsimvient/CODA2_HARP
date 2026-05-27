import { describe, expect, it } from "vitest";
import { assertCoaState } from "./assertions";
import { runCoaPipeline } from "./pipeline";
import { rankCoas } from "./ranking";
import type { CoaCandidate, CoaState, SolverFn } from "./types";

describe("COA invariants", () => {
  it("selected COA references a known candidate", async () => {
    const state = await runCoaPipeline({ mode: "demo" });
    if (state.selectedCoaId) {
      expect(state.candidatesById[state.selectedCoaId]).toBeDefined();
    }
    assertCoaState(state);
  });

  it("every SAT COA with actions has populated logistics", async () => {
    const state = await runCoaPipeline({ mode: "demo" });
    for (const c of Object.values(state.candidatesById)) {
      if (c.status === "sat" && c.selectedActions.length > 0) {
        expect(c.logisticsPlan.kind).toBe("populated");
        if (c.logisticsPlan.kind === "populated") {
          expect(c.logisticsPlan.coaId).toBe(c.id);
        }
      }
    }
  });

  it("scores stay within [0, 1]", async () => {
    const state = await runCoaPipeline({ mode: "demo" });
    for (const c of Object.values(state.candidatesById)) {
      for (const value of Object.values(c.scores)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("UNSAT COAs never rank above SAT COAs", () => {
    const ranked = rankCoas([
      makeCandidate("u", "unsat", 0.99),
      makeCandidate("s", "sat", 0.1),
    ]);
    expect(ranked[0]?.status).toBe("sat");
  });

  it("rejects state when selectedCoaId is unknown", () => {
    const bad: CoaState = {
      candidatesById: {},
      candidateOrder: [],
      status: "ready",
      selectedCoaId: "ghost",
    };
    expect(() => assertCoaState(bad)).toThrow(/selectedCoaId/);
  });
});

function makeCandidate(id: string, status: CoaCandidate["status"], overall: number): CoaCandidate {
  return {
    id,
    runId: "r",
    status,
    label: id,
    selectedActions: status === "sat" ? [{ id: "a", name: "x", type: "x", startTime: 0, duration: 1, resources: [] }] : [],
    logisticsPlan:
      status === "sat"
        ? {
            kind: "populated",
            source: "demo",
            coaId: id,
            lanes: [{ id: "l1", label: "L", chipIds: ["c1"] }],
            chips: [
              {
                id: "c1",
                actionId: "a",
                label: "x",
                laneId: "l1",
                startOffset: 0,
                duration: 1,
                dependencies: [],
              },
            ],
            totalDuration: 1,
          }
        : { kind: "empty", reason: "unsat" },
    scores: {
      feasibility: status === "sat" ? 1 : 0,
      logistics: 0.5,
      effects: 0.5,
      risk: 0.5,
      overall,
    },
  };
}
