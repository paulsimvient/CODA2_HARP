import { computeOverallScore } from "./effects";
import type { CoaCandidate, CoaId, RankingSensitivity } from "./types";

const DEFAULT_WEIGHTS = {
  feasibility: 0.3,
  logistics: 0.2,
  effects: 0.35,
  risk: 0.15,
} as const;

const SCORE_GAP_FRAGILE = 0.04;
const SCORE_GAP_STABLE = 0.08;

/**
 * Deterministic ranking sensitivity — shows whether ordering is fragile to weight changes.
 */
export function analyzeRankingSensitivity(
  candidates: CoaCandidate[]
): RankingSensitivity {
  const sat = candidates.filter((c) => c.status === "sat" && !c.dominatedBy);
  if (sat.length === 0) {
    return {
      confidence: "high",
      reason: "No feasible SAT COAs — ranking sensitivity not applicable.",
      fragilePairs: [],
    };
  }

  if (sat.length === 1) {
    return {
      confidence: "high",
      reason: "Only one non-dominated SAT COA — no rank competition.",
      fragilePairs: [],
    };
  }

  const ordered = [...sat].sort((a, b) => b.scores.overall - a.scores.overall);
  const leader = ordered[0]!;
  const challenger = ordered[1]!;
  const gap = leader.scores.overall - challenger.scores.overall;

  if (gap >= SCORE_GAP_STABLE) {
    return {
      confidence: "high",
      reason: `${leader.label} leads ${challenger.label} by ${(gap * 100).toFixed(0)} score points — stable under default weights.`,
      fragilePairs: [],
    };
  }

  const fragilePairs: RankingSensitivity["fragilePairs"] = [];
  const riskFlips = sweepRiskWeight(leader, challenger, sat);
  if (riskFlips) fragilePairs.push(riskFlips);

  const logisticsFlips = sweepLogisticsWeight(leader, challenger, sat);
  if (logisticsFlips) fragilePairs.push(logisticsFlips);

  const confidence: RankingSensitivity["confidence"] =
    fragilePairs.length > 0 ? "low" : gap >= SCORE_GAP_FRAGILE ? "medium" : "low";

  const reason =
    fragilePairs.length > 0
      ? `${leader.label} and ${challenger.label} are within ${(gap * 100).toFixed(0)} points; changing risk or logistics weight can flip rank.`
      : `${leader.label} leads by ${(gap * 100).toFixed(0)} points — moderate separation but watch commander priorities.`;

  return { confidence, reason, fragilePairs };
}

function sweepRiskWeight(
  leader: CoaCandidate,
  challenger: CoaCandidate,
  pool: CoaCandidate[]
): RankingSensitivity["fragilePairs"][number] | undefined {
  for (const riskW of [0.25, 0.35, 0.45]) {
    const ranked = rankWithWeights(pool, {
      ...DEFAULT_WEIGHTS,
      risk: riskW,
      effects: 1 - DEFAULT_WEIGHTS.feasibility - DEFAULT_WEIGHTS.logistics - riskW,
    });
    const newLeader = ranked[0]?.id;
    if (newLeader && newLeader !== leader.id && ranked[1]?.id === leader.id) {
      return {
        leaderId: leader.id,
        challengerId: challenger.id,
        scoreGap: leader.scores.overall - challenger.scores.overall,
        flipCondition: `${challenger.label} ranks first if risk weight exceeds ~${(riskW * 100).toFixed(0)}% (feasibility/logistics held).`,
      };
    }
  }
  return undefined;
}

function sweepLogisticsWeight(
  leader: CoaCandidate,
  challenger: CoaCandidate,
  pool: CoaCandidate[]
): RankingSensitivity["fragilePairs"][number] | undefined {
  for (const logW of [0.15, 0.28, 0.38]) {
    const ranked = rankWithWeights(pool, {
      feasibility: DEFAULT_WEIGHTS.feasibility,
      logistics: logW,
      effects: 1 - DEFAULT_WEIGHTS.feasibility - logW - DEFAULT_WEIGHTS.risk,
      risk: DEFAULT_WEIGHTS.risk,
    });
    const newLeader = ranked[0]?.id;
    if (newLeader && newLeader !== leader.id && ranked[1]?.id === leader.id) {
      return {
        leaderId: leader.id,
        challengerId: challenger.id,
        scoreGap: leader.scores.overall - challenger.scores.overall,
        flipCondition: `${challenger.label} ranks first if logistics weight exceeds ~${(logW * 100).toFixed(0)}%.`,
      };
    }
  }
  return undefined;
}

function rankWithWeights(
  candidates: CoaCandidate[],
  weights: { feasibility: number; logistics: number; effects: number; risk: number }
): CoaCandidate[] {
  return [...candidates]
    .map((c) => ({
      candidate: c,
      score: computeOverallScore(
        c.scores.feasibility,
        c.scores.logistics,
        c.scores.effects,
        c.scores.risk,
        weights
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.candidate);
}
