import { unsatSummary } from "./constraintTrace";
import type { CoaCandidate, RankingExplanation } from "./types";

export function buildRankingExplanation(
  candidate: CoaCandidate,
  rank: number
): RankingExplanation {
  const tieBreakers: string[] = [];
  if (candidate.dominatedBy) {
    tieBreakers.push(`dominated-by:${candidate.dominatedBy}`);
  }
  if (candidate.selectedActions.length <= 2) {
    tieBreakers.push("parsimony");
  }
  if (candidate.status === "sat") {
    tieBreakers.push("sat-first");
  }

  const rationale = buildCoaRankRationale(candidate, rank);
  return {
    coaId: candidate.id,
    rank,
    totalScore: candidate.scores.overall,
    components: {
      feasibility: candidate.scores.feasibility,
      effects: candidate.scores.effects,
      logistics: candidate.scores.logistics,
      risk: candidate.scores.risk,
      intelFidelity: candidate.intelFidelity?.alignment,
      parsimony:
        candidate.selectedActions.length <= 1
          ? 1
          : candidate.selectedActions.length <= 2
            ? 0.7
            : 0.4,
    },
    tieBreakersApplied: tieBreakers,
    reason: rationale.join(" "),
  };
}

/**
 * Human-readable bullets explaining why a COA ranks where it does.
 * Used by the UI — derived only from structured pipeline fields, not LLM prose.
 */
export function buildCoaRankRationale(candidate: CoaCandidate, rank: number): string[] {
  if (candidate.status === "unsat") {
    const traceReason = unsatSummary(candidate.constraintTrace);
    return [
      `Rank #${rank}: infeasible (UNSAT) — ${traceReason}`,
      "Shown for inspection; ranked below all feasible COAs.",
    ];
  }

  if (candidate.status === "insufficient_evidence") {
    const traceReason = unsatSummary(candidate.constraintTrace);
    return [
      `Rank #${rank}: insufficient evidence — ${traceReason}`,
      "Best available posture is collection and continuity; not ranked as feasible intervention.",
    ];
  }

  if (candidate.status === "error") {
    return [
      `Rank #${rank}: solver error — candidate could not be evaluated.`,
      "Shown for inspection; ranked below all feasible COAs.",
    ];
  }

  const lines: string[] = [`Rank #${rank} because:`];

  if (candidate.scores.feasibility >= 0.99) {
    lines.push("Feasible with available assets and constraints (SAT).");
  }

  if (candidate.intelFidelity) {
    const { alignment, focusTypes, matchedActionTypes, confidence, urgency } =
      candidate.intelFidelity;
    if (alignment >= 0.6 && matchedActionTypes.length > 0) {
      lines.push(
        `Aligns with validated intel (${matchedActionTypes.join(", ")}) across focus: ${focusTypes.join(", ") || "general"}.`
      );
    } else if (focusTypes.length > 0) {
      lines.push(
        `Partial alignment with intel focus (${focusTypes.join(", ")}); fewer matching action types.`
      );
    }
    if (urgency >= 0.75) {
      lines.push("Addresses time-sensitive validated actions.");
    }
    if (confidence >= 0.8) {
      lines.push("Supported by high-confidence grounded intel.");
    }
  }

  if (candidate.scores.logistics >= 0.6) {
    lines.push(
      candidate.scores.logistics >= 0.75
        ? "Moderate logistics burden."
        : "Acceptable logistics footprint."
    );
  } else if (candidate.logisticsPlan.kind === "populated") {
    lines.push("Higher logistics burden relative to peers.");
  }

  if (candidate.effects) {
    if (candidate.effects.expectedImpact >= 0.6) {
      lines.push(`High expected operational impact (${pct(candidate.effects.expectedImpact)}).`);
    }
    if (candidate.effects.risks.length > 0) {
      lines.push(`Risks: ${candidate.effects.risks.slice(0, 2).join("; ")}.`);
    } else if (candidate.scores.risk <= 0.35) {
      lines.push("Acceptable risk profile.");
    }
  }

  if (candidate.dominatedBy) {
    lines.push(`Dominated by another feasible COA (${candidate.dominatedBy}).`);
  }

  if (candidate.selectedActions.length <= 2) {
    lines.push("Parsimonious action set (fewer actions when scores are close).");
  }

  if (candidate.constraintTrace && candidate.status === "sat") {
    const met = candidate.constraintTrace.hard.filter((h) => h.satisfied).length;
    lines.push(`Hard constraints satisfied: ${met}/${candidate.constraintTrace.hard.length}.`);
  }

  lines.push(
    `Score components — feasibility ${pct(candidate.scores.feasibility)}, logistics ${pct(candidate.scores.logistics)}, effects ${pct(candidate.scores.effects)}, risk ${pct(candidate.scores.risk)} → overall ${pct(candidate.scores.overall)}.`
  );

  return lines;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
