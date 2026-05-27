import { describe, expect, it } from "vitest";
import { validateGrounding } from "./grounding";
import type { LLMInterpretation, ScenarioPacket } from "./types";

function basePacket(): ScenarioPacket {
  return {
    commanderIntent: "Protect Port A",
    observedFacts: [
      {
        id: "fact_uas_001",
        domain: "UAS",
        entity: "Port A",
        event: "Unidentified UAS near northern approach",
        time: "14:32",
        location: "Port A northern approach",
        source: "coastal radar",
        confidence: "high",
        severity: "medium",
        rawEvidenceRef: "RADAR-1",
      },
      {
        id: "fact_cyber_001",
        domain: "cyber",
        entity: "Port A logistics system",
        event: "Authentication failures above threshold",
        time: "14:20",
        location: "Port A",
        source: "siem",
        confidence: "high",
        severity: "high",
        rawEvidenceRef: "SIEM-7",
      },
    ],
    knownAssets: ["counter-uas-team"],
    knownAuthorities: {
      "airspace-authorization": "requires-approval",
    },
    constraints: ["Do not assume attribution"],
  };
}

function baseInterpretation(): LLMInterpretation {
  return {
    observedFactsUsed: ["fact_uas_001"],
    inferences: [
      {
        claim: "Possible pressure pattern near Port A",
        supportingFacts: ["fact_uas_001"],
        confidence: "medium",
        whyNotHigher: "Insufficient corroboration",
      },
    ],
    decisionPoints: [
      {
        id: "dp_001",
        question: "Should monitoring be elevated?",
        triggerFacts: ["fact_uas_001"],
        options: [
          {
            id: "dp_001_a",
            label: "Increase passive observation",
            actionType: "observe",
            benefits: ["better awareness"],
            risks: ["resource diversion"],
            requiredAssets: ["counter-uas-team"],
            requiredAuthority: ["airspace-authorization"],
            secondOrderEffects: ["higher communications load"],
            confidence: "medium",
            citedFacts: ["fact_uas_001"],
          },
        ],
        commanderLevel: "section-lead",
        reversible: true,
        informationNeeded: ["Corroborating sensor confirmation"],
      },
    ],
    assumptions: [{ claim: "Events may be linked", status: "unconfirmed" }],
    uncertainties: ["Need additional sensor corroboration"],
    candidateActions: [
      {
        id: "action_001",
        description: "Increase surveillance around Port A",
        citedFacts: ["fact_uas_001"],
        citedInferences: ["Possible pressure pattern near Port A"],
        requiredAssets: ["counter-uas-team"],
        requiredAuthority: ["airspace-authorization"],
        timeSensitivity: "time-bound",
        rationale: "This may indicate surveillance activity and requires confirmation.",
      },
    ],
  };
}

describe("validateGrounding", () => {
  it("passes grounded interpretation", () => {
    const result = validateGrounding(basePacket(), baseInterpretation());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.validatedActionIds).toContain("action_001");
    expect(result.validatedDecisionPointIds).toContain("dp_001");
  });

  it("rejects hallucinated fact IDs", () => {
    const interpretation = baseInterpretation();
    interpretation.candidateActions[0]!.citedFacts = ["fact_nonexistent_999"];
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "hallucinated-fact-id")).toBe(true);
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("rejects actions with no valid fact citations", () => {
    const interpretation = baseInterpretation();
    interpretation.candidateActions[0]!.citedFacts = [];
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "unsupported-action")).toBe(true);
  });

  it("rejects actions that reference unknown assets", () => {
    const interpretation = baseInterpretation();
    interpretation.candidateActions[0]!.requiredAssets = ["nonexistent-asset"];
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "unknown-asset")).toBe(true);
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("rejects actions that reference unknown authority states", () => {
    const interpretation = baseInterpretation();
    interpretation.candidateActions[0]!.requiredAuthority = ["missing-authority"];
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "missing-authority-state")).toBe(
      true
    );
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("rejects inference with no supporting facts", () => {
    const interpretation = baseInterpretation();
    interpretation.inferences[0]!.supportingFacts = [];
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "unsupported-inference")).toBe(true);
  });

  it("rejects non-high confidence inference without whyNotHigher", () => {
    const interpretation = baseInterpretation();
    interpretation.inferences[0]!.whyNotHigher = "";
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "unsupported-inference")).toBe(true);
    expect(result.blockingIssues).toBeGreaterThan(0);
  });

  it("keeps decision point when one option is invalid but another is valid", () => {
    const interpretation = baseInterpretation();
    interpretation.decisionPoints[0]!.options.push({
      id: "dp_001_bad",
      label: "Ungrounded option",
      actionType: "observe",
      benefits: [],
      risks: [],
      requiredAssets: [],
      requiredAuthority: [],
      secondOrderEffects: [],
      confidence: "low",
      citedFacts: [],
    });

    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "unsupported-decision-option")).toBe(true);
    expect(result.validatedDecisionPointIds).toContain("dp_001");
  });

  it("flags inherited option citations as degraded-grounding", () => {
    const interpretation = baseInterpretation();
    interpretation.decisionPoints[0]!.options[0]!.citedFactsInherited = true;

    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "degraded-grounding")).toBe(true);
    expect(result.validatedDecisionPointIds).toContain("dp_001");
    expect(result.reviewIssues).toBeGreaterThan(0);
  });

  it("rejects forbidden certainty language", () => {
    const interpretation = baseInterpretation();
    interpretation.candidateActions[0]!.rationale =
      "This proves the attack and confirms the attack path.";
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "hedge-violation")).toBe(true);
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("rejects high-confidence attribution claims when constrained", () => {
    const interpretation = baseInterpretation();
    interpretation.inferences[0]!.claim = "The adversary is coordinating this operation.";
    interpretation.inferences[0]!.confidence = "high";
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "constraint-violation")).toBe(true);
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("rejects invented entities not present in facts", () => {
    const interpretation = baseInterpretation();
    interpretation.candidateActions[0]!.description =
      "Deploy UAV assets to Harbor Zulu for immediate interception.";
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "invented-entity")).toBe(true);
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("rejects action when cited inference claim does not exist", () => {
    const interpretation = baseInterpretation();
    interpretation.candidateActions[0]!.citedInferences = ["Unknown inference text"];
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "unsupported-action")).toBe(true);
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("rejects action that cites a flagged inference", () => {
    const interpretation = baseInterpretation();
    interpretation.inferences[0]!.whyNotHigher = "";
    const result = validateGrounding(basePacket(), interpretation);
    expect(result.issues.some((i) => i.kind === "unsupported-inference")).toBe(true);
    expect(
      result.issues.some(
        (i) =>
          i.kind === "unsupported-action" &&
          i.actionId === "action_001" &&
          /Cites flagged inference/.test(i.reason)
      )
    ).toBe(true);
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("rejects action when required authority is prohibited", () => {
    const packet = basePacket();
    packet.knownAuthorities = {
      "airspace-authorization": "prohibited",
    };
    const interpretation = baseInterpretation();
    const result = validateGrounding(packet, interpretation);
    expect(result.issues.some((i) => i.kind === "unsupported-action")).toBe(true);
    expect(result.validatedActionIds).not.toContain("action_001");
  });

  it("counts decision-point and option citations as used facts", () => {
    const interpretation = baseInterpretation();
    interpretation.observedFactsUsed = [];
    interpretation.inferences = [];
    interpretation.candidateActions = [];
    interpretation.decisionPoints[0]!.triggerFacts = ["fact_cyber_001"];
    interpretation.decisionPoints[0]!.options[0]!.citedFacts = ["fact_cyber_001"];

    const result = validateGrounding(basePacket(), interpretation);
    expect(result.unusedFacts).not.toContain("fact_cyber_001");
  });

  it("blocks only the action with scoped policy violation", () => {
    const interpretation = baseInterpretation();
    interpretation.candidateActions.push({
      id: "action_002",
      description: "Maintain current patrol posture around Port A",
      citedFacts: ["fact_uas_001"],
      citedInferences: ["Possible pressure pattern near Port A"],
      requiredAssets: ["counter-uas-team"],
      requiredAuthority: ["airspace-authorization"],
      timeSensitivity: "routine",
      rationale: "This may indicate routine monitoring activity.",
    });
    interpretation.candidateActions[0]!.description =
      "Deploy UAV assets to Harbor Zulu for immediate interception.";

    const result = validateGrounding(basePacket(), interpretation);
    expect(result.validatedActionIds).not.toContain("action_001");
    expect(result.validatedActionIds).toContain("action_002");
  });
});
