import { describe, expect, it } from "vitest";
import { validateGrounding } from "./grounding";
import type { LLMInterpretation, ScenarioPacket } from "./types";

function packet(): ScenarioPacket {
  return {
    commanderIntent: "Defend port",
    observedFacts: [
      {
        id: "fact_mar_002",
        domain: "maritime",
        entity: "Sub contact",
        event: "transient acoustic signature",
        time: "06:33",
        source: "buoy",
        confidence: "low",
        severity: "high",
      },
    ],
    knownAssets: ["asw-team"],
    constraints: [],
  };
}

describe("grounding confidence discipline", () => {
  it("flags confidence inflation above cited facts", () => {
    const interpretation: LLMInterpretation = {
      observedFactsUsed: ["fact_mar_002"],
      inferences: [],
      decisionPoints: [],
      assumptions: [],
      uncertainties: [],
      candidateActions: [
        {
          id: "act_1",
          description: "Conduct kinetic strike on submarine contact",
          citedFacts: ["fact_mar_002"],
          citedInferences: [],
          confidence: "high",
          rationale: "May require confirmation before engagement",
        },
      ],
    };

    const result = validateGrounding(packet(), interpretation);
    expect(
      result.issues.some((i) => i.kind === "confidence-exceeds-evidence")
    ).toBe(true);
    expect(result.validatedActionIds).not.toContain("act_1");
  });
});
