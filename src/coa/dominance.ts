import type { CoaCandidate, CoaId } from "./types";

/**
 * Flags COAs that are strictly dominated by another SAT candidate.
 * Dominated COAs remain visible but carry dominatedBy for UI/audit.
 */
export function applyDominanceFlags(candidates: CoaCandidate[]): CoaCandidate[] {
  const sat = candidates.filter((c) => c.status === "sat");
  const dominatedBy = new Map<CoaId, CoaId>();

  for (const a of sat) {
    for (const b of sat) {
      if (a.id === b.id) continue;
      if (dominates(b, a)) {
        dominatedBy.set(a.id, b.id);
        break;
      }
    }
  }

  return candidates.map((c) => {
    const dominator = dominatedBy.get(c.id);
    return dominator ? { ...c, dominatedBy: dominator } : c;
  });
}

function dominates(a: CoaCandidate, b: CoaCandidate): boolean {
  const eps = 0.02;
  const aBetterOrEqual =
    a.scores.effects >= b.scores.effects - eps &&
    a.scores.risk <= b.scores.risk + eps &&
    a.scores.logistics >= b.scores.logistics - eps &&
    a.scores.feasibility >= b.scores.feasibility - eps &&
    a.selectedActions.length <= b.selectedActions.length;

  const strictlyBetter =
    a.scores.overall > b.scores.overall + eps ||
    a.selectedActions.length < b.selectedActions.length;

  return aBetterOrEqual && strictlyBetter;
}
