import { describe, expect, it } from "vitest";
import { normalizeInterpretationForTest } from "./interpreter";

describe("normalizeInterpretation", () => {
  it("inherits option citedFacts from decisionPoint triggerFacts when missing", () => {
    const raw = {
      observedFactsUsed: ["fact_uas_001"],
      inferences: [],
      decisionPoints: [
        {
          id: "dp_001",
          question: "Monitor UAS?",
          triggerFacts: ["fact_uas_001"],
          options: [
            {
              id: "op_001",
              label: "Monitor UAS activity",
              actionType: "observe",
              benefits: [],
              risks: [],
              requiredAssets: [],
              requiredAuthority: [],
              secondOrderEffects: [],
              confidence: "medium",
              citedFacts: [],
            },
          ],
          commanderLevel: "watch-floor",
          reversible: true,
          informationNeeded: [],
        },
      ],
      assumptions: [],
      uncertainties: [],
      candidateActions: [],
    };

    const normalized = normalizeInterpretationForTest(raw);
    const option = normalized.decisionPoints[0]?.options[0];
    expect(option?.citedFacts).toEqual(["fact_uas_001"]);
    expect(option?.citedFactsInherited).toBe(true);
    expect(option?.grounding).toBe("inherited");
  });
});
