import { describe, expect, it } from "vitest";
import { selectAtomicTestsForTechniques } from "./atomicCatalog";
import { executeLabAtomicTests } from "./labHarness";

describe("executeLabAtomicTests", () => {
  it("executes allowlisted tests in-process deterministically", async () => {
    const tests = selectAtomicTestsForTechniques(["T1110", "T1078"]);
    const result = await executeLabAtomicTests({
      coaId: "coa-harness",
      citedFactIds: ["fact_cyber_001"],
      validatedActionIds: ["ia_1"],
      tests,
    });

    expect(result.outcomes.length).toBeGreaterThan(0);
    expect(result.outcomes.every((o) => o.harness === "in-process")).toBe(true);
    expect(result.expectedDetections.length).toBeGreaterThan(0);
  });
});
