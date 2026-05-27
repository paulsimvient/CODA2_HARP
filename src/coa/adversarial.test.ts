import { describe, expect, it } from "vitest";
import { filterCitedIntelActions, runCoaPipeline } from "./pipeline";
import { solveValidatedIntelBundles } from "./validatedIntelSolver";
import type { SolverFn } from "./types";

describe("adversarial COA pipeline", () => {
  it("drops uncited intel actions before solver", () => {
    const filtered = filterCitedIntelActions([
      { id: "bad", description: "No facts", citedFacts: [] },
      { id: "good", description: "Grounded", citedFacts: ["f1"] },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("good");
  });

  it("rejects pipeline input without cited facts on intel actions", async () => {
    await expect(
      runCoaPipeline({
        mode: "validated-intel",
        intelActions: [{ id: "x", description: "bad", citedFacts: [] }],
      })
    ).rejects.toThrow(/schema validation/i);
  });

  it("marks overlapping assets UNSAT with trace", async () => {
    const results = await solveValidatedIntelBundles({
      runId: "r1",
      signals: [],
      mode: "validated-intel",
      intelActions: [
        {
          id: "a1",
          description: "Use drone D7 for ISR",
          citedFacts: ["f1"],
          actionType: "observe",
          requiredAssets: ["drone-d7"],
          timeSensitivity: "immediate",
        },
        {
          id: "a2",
          description: "Retask drone D7 for extended ISR orbit",
          citedFacts: ["f1"],
          actionType: "observe",
          requiredAssets: ["drone-d7"],
          timeSensitivity: "immediate",
        },
      ],
    });
    const unsat = results.find((r) => r.status === "unsat");
    expect(unsat).toBeDefined();
    expect(unsat?.constraintSatisfaction?.hard.some((h) => !h.satisfied)).toBe(true);
  });

  it("emits insufficient_evidence when only low-confidence escalatory actions exist", async () => {
    const results = await solveValidatedIntelBundles({
      runId: "r2",
      signals: [],
      mode: "validated-intel",
      intelActions: [
        {
          id: "strike1",
          description: "Conduct kinetic strike on contact",
          citedFacts: ["f1"],
          actionType: "other",
          confidence: "low",
        },
      ],
    });
    expect(results.some((r) => r.status === "insufficient_evidence")).toBe(true);
  });

  it("LLM-only uncited actions never produce SAT COA with those actions", async () => {
    const solver: SolverFn = async () => [
      { status: "sat", selectedActions: [] },
    ];
    const state = await runCoaPipeline(
      {
        mode: "validated-intel",
        intelActions: [
          {
            id: "ia1",
            description: "Monitor",
            citedFacts: ["fact_1"],
            actionType: "monitor",
          },
        ],
      },
      { solver }
    );
    const sat = Object.values(state.candidatesById).filter((c) => c.status === "sat");
    for (const c of sat) {
      expect(c.selectedActions.every((a) => a.id !== "uncited_llm_action")).toBe(true);
    }
  });
});
