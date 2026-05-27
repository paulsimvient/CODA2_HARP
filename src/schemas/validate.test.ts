import { describe, expect, it } from "vitest";
import {
  assertLLMInterpretationSchema,
  assertPipelineInputSchema,
  SchemaValidationError,
} from "./validate";

describe("schema boundaries", () => {
  it("accepts valid pipeline input", () => {
    const input = assertPipelineInputSchema({
      mode: "validated-intel",
      intelActions: [
        { id: "a1", description: "Monitor", citedFacts: ["f1"] },
      ],
    });
    expect(input.mode).toBe("validated-intel");
  });

  it("rejects intel action with empty citedFacts", () => {
    expect(() =>
      assertPipelineInputSchema({
        mode: "validated-intel",
        intelActions: [{ id: "a1", description: "Bad", citedFacts: [] }],
      })
    ).toThrow(SchemaValidationError);
  });

  it("accepts minimal LLM interpretation shape", () => {
    const interpretation = assertLLMInterpretationSchema({
      observedFactsUsed: ["f1"],
      inferences: [],
      decisionPoints: [],
      assumptions: [],
      uncertainties: [],
      candidateActions: [
        {
          id: "action_001",
          description: "Monitor",
          citedFacts: ["f1"],
          citedInferences: [],
          requiredAssets: [],
          requiredAuthority: [],
          rationale: "May indicate activity.",
        },
      ],
    });
    expect(interpretation.candidateActions).toHaveLength(1);
  });
});
