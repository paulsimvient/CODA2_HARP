import { describe, expect, it } from "vitest";
import { solveValidatedIntelBundles } from "./validatedIntelSolver";

describe("solveValidatedIntelBundles", () => {
  it("returns multiple competing SAT bundles, not one mega-bundle", async () => {
    const results = await solveValidatedIntelBundles({
      runId: "run_test",
      signals: [],
      mode: "validated-intel",
      intelActions: [
        {
          id: "ia_cyber",
          description: "Investigate Keelung cyber anomalies",
          citedFacts: ["fact_cyber_001"],
          actionType: "investigate",
          requiredAssets: ["cyber-team"],
          timeSensitivity: "immediate",
          confidence: "high",
        },
        {
          id: "ia_air",
          description: "Retask ISR for mixed air tracks",
          citedFacts: ["fact_air_001"],
          actionType: "observe",
          requiredAssets: ["isr-wing"],
          timeSensitivity: "time-bound",
          confidence: "medium",
        },
        {
          id: "ia_mar",
          description: "Coordinate patrol for erratic vessels",
          citedFacts: ["fact_mar_001"],
          actionType: "coordinate",
          requiredAssets: ["patrol-flotilla"],
          timeSensitivity: "time-bound",
          confidence: "high",
        },
      ],
    });

    const sat = results.filter((r) => r.status === "sat");
    expect(sat.length).toBeGreaterThanOrEqual(3);
    expect(sat.some((r) => r.selectedActions.length === 1)).toBe(true);
    expect(sat.every((r) => r.constraintSatisfaction?.hard.some((h) => h.id === "hc-cited-facts"))).toBe(
      true
    );
  });
});
