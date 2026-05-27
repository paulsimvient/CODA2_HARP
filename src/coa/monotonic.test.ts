import { describe, expect, it } from "vitest";
import { computeOverallScore } from "./effects";

describe("monotonic scoring", () => {
  it("higher risk never increases overall score (holding other inputs)", () => {
    const lowRisk = computeOverallScore(1, 0.8, 0.7, 0.2);
    const highRisk = computeOverallScore(1, 0.8, 0.7, 0.9);
    expect(highRisk).toBeLessThanOrEqual(lowRisk);
  });

  it("lower feasibility never increases overall score", () => {
    const highFeas = computeOverallScore(1, 0.8, 0.7, 0.3);
    const lowFeas = computeOverallScore(0.2, 0.8, 0.7, 0.3);
    expect(lowFeas).toBeLessThanOrEqual(highFeas);
  });
});
