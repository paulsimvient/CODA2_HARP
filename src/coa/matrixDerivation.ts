import type { CoaCandidate } from "./types";

/** Auditable matrix cell with provenance (commander matrix). */
export type MatrixCellDerivation = {
  value: string;
  derivedFrom: string[];
  explanation: string;
};

export type MatrixRowId =
  | "overall"
  | "risk"
  | "logistics"
  | "feasibility"
  | "effects"
  | "status"
  | "actions";

export function buildMatrixDerivation(
  coa: CoaCandidate | undefined,
  rowId: MatrixRowId
): MatrixCellDerivation {
  if (!coa) {
    return { value: "—", derivedFrom: [], explanation: "No COA candidate loaded." };
  }

  switch (rowId) {
    case "overall":
      return {
        value: `${Math.round(coa.scores.overall * 100)}%`,
        derivedFrom: [
          "scores.feasibility",
          "scores.logistics",
          "scores.effects",
          "scores.risk",
          ...(coa.intelFidelity ? ["intelFidelity.adjustments"] : []),
        ],
        explanation: coa.rankingExplanation?.reason
          ? coa.rankingExplanation.reason
          : `Weighted composite: feasibility, logistics, effects, and inverted risk.`,
      };
    case "risk": {
      const risk = coa.scores.risk;
      const derivedFrom = ["scores.risk", "effects.risk"];
      const parts: string[] = [];
      if (coa.effects?.risks?.length) {
        derivedFrom.push("effects.risks");
        parts.push(coa.effects.risks.slice(0, 2).join("; "));
      }
      if (coa.intelFidelity && coa.intelFidelity.riskAdjustment > 0.02) {
        derivedFrom.push("intelFidelity.riskAdjustment");
        parts.push("Intel fidelity elevated risk from urgency or low-confidence evidence.");
      }
      return {
        value: riskLabel(risk),
        derivedFrom,
        explanation:
          parts.length > 0
            ? parts.join(" ")
            : risk <= 0.35
              ? "Risk score in acceptable band for current action mix."
              : "Risk elevated by action types or operational tempo.",
      };
    }
    case "logistics":
      return buildLogisticsMatrixDerivation(coa);
    case "feasibility":
      return {
        value: `${Math.round(coa.scores.feasibility * 100)}%`,
        derivedFrom: ["solver.status", "constraintTrace.hard"],
        explanation:
          coa.status === "sat"
            ? constraintSummary(coa, true)
            : coa.status === "insufficient_evidence"
              ? "Intervention COAs not justified — evidence or authority insufficient."
              : constraintSummary(coa, false),
      };
    case "effects":
      return {
        value: coa.effects
          ? `${Math.round(coa.effects.expectedImpact * 100)}%`
          : `${Math.round(coa.scores.effects * 100)}%`,
        derivedFrom: coa.effects?.cyberEffects
          ? [
              "effects.expectedImpact",
              "effects.confidence",
              "effects.explanation",
              "effects.cyberEffects.residualRisk",
              "effects.cyberEffects.techniquesEvaluated",
            ]
          : coa.effects
            ? ["effects.expectedImpact", "effects.confidence", "effects.explanation"]
            : ["scores.effects"],
        explanation:
          coa.effects?.cyberEffects
            ? `${coa.effects.explanation} [${coa.effects.cyberEffects.executionMode === "simulated" ? "SIMULATED" : "LAB"} cyber-effects via ${coa.effects.cyberEffects.provider}]`
            : coa.effects?.explanation ??
              "Effects engine has not annotated this candidate yet.",
      };
    case "status":
      return {
        value: statusLabel(coa.status),
        derivedFrom: ["solver.status", "constraintTrace"],
        explanation:
          coa.status === "unsat"
            ? unsatExplanation(coa)
            : coa.status === "insufficient_evidence"
              ? "No high-confidence intervention bundle — prefer collection and continuity."
              : coa.status === "sat"
                ? "Solver found a feasible action bundle under hard constraints."
                : "Solver or pipeline error.",
      };
    case "actions":
      return {
        value: String(coa.selectedActions.length),
        derivedFrom: ["selectedActions", "intelActions.validated"],
        explanation:
          coa.selectedActions.length > 0
            ? `Bundle: ${coa.selectedActions.map((a) => a.name).slice(0, 3).join("; ")}${coa.selectedActions.length > 3 ? "…" : ""}`
            : "No actions selected — infeasible or insufficient evidence.",
      };
    default:
      return { value: "—", derivedFrom: [], explanation: "" };
  }
}

export function buildLogisticsMatrixDerivation(coa: CoaCandidate): MatrixCellDerivation {
  const value = `${Math.round(coa.scores.logistics * 100)}%`;

  if (coa.logisticsPlan.kind !== "populated") {
    return {
      value,
      derivedFrom: ["scores.logistics", "logisticsPlan.kind"],
      explanation:
        coa.status === "unsat"
          ? "No feasible logistics plan — solver marked COA infeasible."
          : "Logistics plan not populated for this candidate.",
    };
  }

  const plan = coa.logisticsPlan;
  const factIds = [
    ...new Set(
      plan.chips.flatMap((chip) => chip.linkedFactIds ?? chip.citedFactIds ?? [])
    ),
  ];
  const dependencyCount = plan.chips.reduce(
    (sum, chip) => sum + chip.dependencies.length,
    0
  );
  const laneNames = plan.lanes.map((lane) => lane.label);
  const laneSummary =
    laneNames.length > 0
      ? plan.lanes
          .map((lane) => {
            const chipCount = lane.chipIds.length;
            return `${lane.label} (${chipCount} chip${chipCount === 1 ? "" : "s"})`;
          })
          .join("; ")
      : "none";

  const derivedFrom = [
    ...plan.chips.map((chip) => chip.id),
    ...plan.lanes.map((lane) => lane.id),
    ...factIds.map((id) => `fact:${id}`),
    "scores.logistics",
  ];

  const actionLabels = plan.chips
    .slice(0, 4)
    .map((chip) => chip.label)
    .join("; ");

  return {
    value,
    derivedFrom,
    explanation: [
      `Plan uses lanes: ${laneSummary}.`,
      `${plan.chips.length} action chip(s) across ${plan.lanes.length} lane(s)${actionLabels ? ` — ${actionLabels}${plan.chips.length > 4 ? "…" : ""}` : ""}.`,
      `Facts: ${factIds.length > 0 ? factIds.join(", ") : "none"}.`,
      `Dependencies: ${dependencyCount}.`,
      `Timeline span: ${Math.round(plan.totalDuration)}s.`,
    ].join(" "),
  };
}

function constraintSummary(coa: CoaCandidate, satisfied: boolean): string {
  const trace = coa.constraintTrace;
  if (!trace || trace.hard.length === 0) {
    return satisfied
      ? "Feasible under default hard constraints."
      : "Marked infeasible by solver.";
  }
  const failed = trace.hard.filter((h) => !h.satisfied);
  if (failed.length === 0) {
    return `All ${trace.hard.length} hard constraint(s) satisfied.`;
  }
  return failed.map((h) => h.reason).join("; ");
}

function unsatExplanation(coa: CoaCandidate): string {
  const failed = coa.constraintTrace?.hard.filter((h) => !h.satisfied) ?? [];
  if (failed.length === 0) return "Marked UNSAT — see constraint trace.";
  return failed.map((h) => h.reason).join("; ");
}

function riskLabel(value: number): string {
  if (value <= 0.35) return "LOW";
  if (value <= 0.6) return "MED";
  return "HIGH";
}

function statusLabel(
  status: CoaCandidate["status"]
): string {
  if (status === "sat") return "SAT";
  if (status === "unsat") return "UNSAT";
  if (status === "insufficient_evidence") return "INSUFF.";
  return "ERR";
}
