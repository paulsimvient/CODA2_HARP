import { describe, expect, it } from "vitest";
import {
  confidenceExceedsEvidence,
  detectEvidenceConflicts,
  maxConfidenceFromFactIds,
} from "./evidence";
import type { ObservedFact } from "./types";

describe("evidence", () => {
  it("detects degraded AIS / mixed-track conflicts", () => {
    const facts: ObservedFact[] = [
      {
        id: "fact_sig_001",
        domain: "signals",
        entity: "AIS",
        event: "AIS track quality degraded",
        time: "06:05",
        source: "fusion",
        confidence: "high",
        severity: "high",
      },
      {
        id: "fact_air_001",
        domain: "air",
        entity: "Radar",
        event: "mixed real and false high-speed contacts",
        time: "06:29",
        source: "radar",
        confidence: "medium",
        severity: "critical",
      },
    ];
    const conflicts = detectEvidenceConflicts(facts);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some((c) => c.effect === "block-high-risk-actions")).toBe(true);
  });

  it("caps action confidence to cited fact ceiling", () => {
    const facts: ObservedFact[] = [
      {
        id: "fact_001",
        domain: "maritime",
        entity: "Contact",
        event: "transient acoustic signature",
        time: "06:33",
        source: "buoy",
        confidence: "low",
        severity: "high",
      },
    ];
    expect(maxConfidenceFromFactIds(facts, ["fact_001"])).toBe("low");
    expect(confidenceExceedsEvidence("high", "low")).toBe(true);
    expect(confidenceExceedsEvidence("low", "low")).toBe(false);
  });
});
