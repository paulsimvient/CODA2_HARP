import { describe, expect, it } from "vitest";
import { atomicRedTeamProvider } from "./atomic-red-team";

describe("atomicRedTeamProvider", () => {
  it("returns lab-executed results with atomic test traceability", async () => {
    const result = await atomicRedTeamProvider({
      coaId: "coa-lab-1",
      validatedActionIds: ["ia_cyber"],
      citedFactIds: ["fact_cyber_001"],
      actionDescriptions: ["Investigate authentication anomalies"],
      actionTypes: ["cyber"],
      provider: "atomic-red-team",
      humanApproved: true,
      labEnvironmentConfirmed: true,
    });

    expect(result.executionMode).toBe("lab-executed");
    expect(result.provider).toBe("atomic-red-team");
    expect(result.atomicTestsExecuted?.length).toBeGreaterThan(0);
    expect(result.evidenceRefs.some((r) => r.startsWith("atomic:"))).toBe(true);
    expect(result.observedDetections.length).toBeGreaterThan(0);
  });
});
