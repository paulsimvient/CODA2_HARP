import { selectAtomicTestsForTechniques } from "../atomicCatalog";
import { executeLabAtomicTests } from "../labHarness";
import { mapActionsToTechniques } from "../techniqueMap";
import { CyberEmulationPolicyError } from "../types";
import type {
  AtomicTestExecution,
  CyberEmulationProviderFn,
  CyberEffectResult,
} from "../types";

/**
 * Phase 2: small allowlisted Atomic-style validation checks in lab only.
 * Requires human approval and lab environment confirmation (enforced in adapter).
 */
export const atomicRedTeamProvider: CyberEmulationProviderFn = async (
  request
): Promise<CyberEffectResult> => {
  const techniques = mapActionsToTechniques(
    request.actionDescriptions,
    request.actionTypes
  );
  const techniqueIds = techniques.map((t) => t.techniqueId);
  const tests = selectAtomicTestsForTechniques(techniqueIds);

  if (tests.length === 0) {
    throw new CyberEmulationPolicyError({
      code: "technique-not-allowlisted",
      message:
        "No allowlisted Atomic lab tests match the validated cyber action techniques.",
    });
  }

  const harness = await executeLabAtomicTests({
    coaId: request.coaId,
    citedFactIds: request.citedFactIds,
    validatedActionIds: request.validatedActionIds,
    tests,
  });

  const atomicTestsExecuted: AtomicTestExecution[] = harness.outcomes.map((o) => ({
    testId: o.testId,
    name: o.name,
    techniqueId: o.techniqueId,
    detectionObserved: o.detectionObserved,
    harness: o.harness,
  }));

  const executed = harness.outcomes.filter((o) => o.executed).length;
  const detected = harness.outcomes.filter((o) => o.detectionObserved).length;
  const detectionRate = executed > 0 ? detected / executed : 0;

  const residualRisk = clamp(0.7 - detectionRate * 0.45 - request.citedFactIds.length * 0.03, 0.1, 0.75);
  const confidence = clamp(
    0.55 + detectionRate * 0.35 + Math.min(tests.length, 3) * 0.05,
    0.4,
    0.95
  );

  const harnessLabel =
    harness.outcomes[0]?.harness === "http" ? "external lab harness" : "in-process lab executor";

  const explanation = [
    `Lab cyber-effects validation (${executed} Atomic test(s)) via ${harnessLabel}.`,
    `Detections observed for ${detected}/${executed} test(s).`,
    `Techniques: ${techniqueIds.join(", ") || "none"}.`,
    `Residual risk ${Math.round(residualRisk * 100)}% based on lab detection coverage.`,
    "Lab-only execution — not production.",
  ].join(" ");

  const evidenceRefs = [
    ...request.citedFactIds,
    ...atomicTestsExecuted.map((t) => `atomic:${t.testId}`),
  ];

  return {
    coaId: request.coaId,
    validatedActionIds: request.validatedActionIds,
    citedFactIds: request.citedFactIds,
    provider: "atomic-red-team",
    executionMode: "lab-executed",
    residualRisk,
    confidence,
    techniquesEvaluated: techniques,
    expectedDetections: harness.expectedDetections,
    observedDetections: harness.observedDetections,
    atomicTestsExecuted,
    explanation,
    evidenceRefs,
  };
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
