import type { ConfidenceLevel, ObservedFact } from "./types";

/** Deterministic evidence-quality flags derived from normalized facts (not LLM). */
export type EvidenceConflict = {
  id: string;
  facts: string[];
  issue: "contradiction" | "degraded-source" | "single-source" | "stale";
  effect: "lower-confidence" | "block-high-risk-actions" | "require-confirmation";
  reason: string;
};

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Scans observed facts for contradictions and degraded/single-source patterns.
 * Used by grounding and COA constraint rules — not by the LLM.
 */
export function detectEvidenceConflicts(facts: ObservedFact[]): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  let conflictIndex = 0;

  const byDomain = groupBy(facts, (f) => f.domain);

  for (const [domain, domainFacts] of Object.entries(byDomain)) {
    const degraded = domainFacts.filter((f) => isDegradedSourceFact(f));
    if (degraded.length > 0) {
      conflicts.push({
        id: `evidence-${++conflictIndex}`,
        facts: degraded.map((f) => f.id),
        issue: "degraded-source",
        effect: "block-high-risk-actions",
        reason: `${domain}: source quality degraded or mixed real/false reporting`,
      });
    }

    const lowOnly = domainFacts.every((f) => f.confidence === "low");
    if (domainFacts.length === 1 && lowOnly) {
      conflicts.push({
        id: `evidence-${++conflictIndex}`,
        facts: domainFacts.map((f) => f.id),
        issue: "single-source",
        effect: "lower-confidence",
        reason: `${domain}: single low-confidence report — corroboration required for strong COAs`,
      });
    }
  }

  const airMixed = facts.filter((f) =>
    /mixed real and false|false.*contact/i.test(f.event)
  );
  const airTracks = facts.filter(
    (f) => f.domain === "air" && /track|contact|radar/i.test(f.event)
  );
  if (airMixed.length > 0 && airTracks.length > 1) {
    conflicts.push({
      id: `evidence-${++conflictIndex}`,
      facts: [...new Set([...airMixed, ...airTracks].map((f) => f.id))],
      issue: "contradiction",
      effect: "block-high-risk-actions",
      reason: "Air picture reports both contacts and mixed real/false tracks",
    });
  }

  const aisDegraded = facts.find((f) =>
    /ais.*degraded|positional jump/i.test(f.event)
  );
  const maritimeAnomaly = facts.filter((f) => f.domain === "maritime");
  if (aisDegraded && maritimeAnomaly.length > 0) {
    conflicts.push({
      id: `evidence-${++conflictIndex}`,
      facts: [aisDegraded.id, ...maritimeAnomaly.map((f) => f.id)],
      issue: "degraded-source",
      effect: "require-confirmation",
      reason: "Maritime picture may be unreliable while AIS quality is degraded",
    });
  }

  return conflicts;
}

export function maxConfidenceFromFactIds(
  facts: ObservedFact[],
  factIds: string[]
): ConfidenceLevel {
  const byId = new Map(facts.map((f) => [f.id, f]));
  let max: ConfidenceLevel = "low";
  for (const id of factIds) {
    const fact = byId.get(id);
    if (!fact) continue;
    if (CONFIDENCE_RANK[fact.confidence] > CONFIDENCE_RANK[max]) {
      max = fact.confidence;
    }
  }
  return max;
}

export function confidenceExceedsEvidence(
  actionConfidence: ConfidenceLevel | undefined,
  evidenceCeiling: ConfidenceLevel
): boolean {
  if (!actionConfidence) return false;
  return CONFIDENCE_RANK[actionConfidence] > CONFIDENCE_RANK[evidenceCeiling];
}

export function isHighRiskActionType(
  actionType: string | undefined,
  description: string
): boolean {
  const blob = `${actionType ?? ""} ${description}`.toLowerCase();
  return (
    (actionType === "other" && /strike|kinetic|engage|intercept/i.test(blob)) ||
    /strike|kinetic|offensive cyber|escalat/i.test(blob)
  );
}

function isDegradedSourceFact(fact: ObservedFact): boolean {
  const blob = `${fact.event} ${fact.source}`.toLowerCase();
  return (
    /degraded|rumor|false|mixed real|intermittent|unavailable|jump/i.test(blob) ||
    (fact.confidence === "low" && fact.severity === "critical")
  );
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (out[key] ??= []).push(item);
  }
  return out;
}
