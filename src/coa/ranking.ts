import type { CoaCandidate } from "./types";

// ─── Ranking ──────────────────────────────────────────────────────────────────

/**
 * Ranks COA candidates best-first.
 *
 * Rules:
 *   1. SAT candidates always rank above insufficient-evidence, UNSAT, and ERROR.
 *   2. Among SAT candidates, rank by overall score descending.
 *   3. Among tied overall scores, prefer fewer selected actions (parsimony).
 *   4. insufficient_evidence, then UNSAT/ERROR, sorted by label.
 *
 * Ranking is pure — it never mutates the candidate objects.
 * The pipeline calls this after effects are applied so overall scores
 * are final before ordering is decided.
 */
export function rankCoas(candidates: CoaCandidate[]): CoaCandidate[] {
  const sat = candidates
    .filter((c) => c.status === "sat")
    .sort((a, b) => {
      const scoreDiff = b.scores.overall - a.scores.overall;
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
      return a.selectedActions.length - b.selectedActions.length;
    });

  const insufficient = candidates
    .filter((c) => c.status === "insufficient_evidence")
    .sort((a, b) => a.label.localeCompare(b.label));

  const nonSat = candidates
    .filter((c) => c.status !== "sat" && c.status !== "insufficient_evidence")
    .sort((a, b) => a.label.localeCompare(b.label));

  // Dominated SAT candidates sort after non-dominated SAT at same score band
  const satWithDominatedLast = [
    ...sat.filter((c) => !c.dominatedBy),
    ...sat.filter((c) => c.dominatedBy),
  ];

  return [...satWithDominatedLast, ...insufficient, ...nonSat];
}
