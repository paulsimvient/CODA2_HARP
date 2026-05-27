import type { ConstraintTrace, SolverCandidateResult } from "./types";

export function formatConstraintTraces(trace: ConstraintTrace | undefined): string[] {
  if (!trace) return [];
  const lines: string[] = [];
  for (const hard of trace.hard) {
    lines.push(
      `${hard.satisfied ? "✓" : "✗"} ${hard.label}: ${hard.reason}${
        hard.evidence?.length ? ` (${hard.evidence.join(", ")})` : ""
      }`
    );
  }
  return lines;
}

export function unsatSummary(trace: ConstraintTrace | undefined): string {
  if (!trace) return "Constraint evaluation failed.";
  const failed = trace.hard.filter((h) => !h.satisfied);
  if (failed.length === 0) return "Marked UNSAT by solver.";
  return failed.map((h) => h.reason).join("; ");
}

export function solverResultToConstraintTrace(
  result: SolverCandidateResult
): ConstraintTrace | undefined {
  const cs = result.constraintSatisfaction;
  if (!cs) return undefined;
  return {
    hard: cs.hard.map((h) => ({
      id: h.id,
      label: h.label ?? h.id,
      satisfied: h.satisfied,
      reason: h.reason ?? (h.satisfied ? "satisfied" : "violated"),
      evidence: h.evidence,
    })),
    soft: cs.soft.map((s) => ({
      id: s.id,
      label: s.label ?? s.id,
      score: s.score ?? (s.satisfied ? 1 : 0),
      weight: s.weight,
      reason: s.reason ?? (s.satisfied ? "preference met" : "preference missed"),
    })),
  };
}
