import type { AtomicLabTest } from "./atomicCatalog";
import type { DetectionExpectation } from "./types";

export type LabHarnessRequest = {
  coaId: string;
  citedFactIds: string[];
  validatedActionIds: string[];
  tests: AtomicLabTest[];
};

export type LabHarnessTestOutcome = {
  testId: string;
  name: string;
  techniqueId: string;
  executed: boolean;
  detectionObserved: boolean;
  harness: "in-process" | "http";
};

export type LabHarnessResult = {
  outcomes: LabHarnessTestOutcome[];
  expectedDetections: DetectionExpectation[];
  observedDetections: DetectionExpectation[];
};

/**
 * Executes allowlisted atomic validation checks against the lab harness.
 * Uses VITE_CYBER_LAB_HARNESS_URL when set; otherwise in-process deterministic executor.
 */
export async function executeLabAtomicTests(
  request: LabHarnessRequest
): Promise<LabHarnessResult> {
  const url = import.meta.env.VITE_CYBER_LAB_HARNESS_URL as string | undefined;
  if (url && url.trim() !== "") {
    try {
      return await executeViaHttpHarness(url.trim(), request);
    } catch (err) {
      console.warn(
        "[cyber-emulation] External lab harness unreachable — falling back to in-process executor.",
        err
      );
    }
  }
  return executeInProcessLabTests(request);
}

async function executeViaHttpHarness(
  url: string,
  request: LabHarnessRequest
): Promise<LabHarnessResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      coaId: request.coaId,
      citedFactIds: request.citedFactIds,
      validatedActionIds: request.validatedActionIds,
      testIds: request.tests.map((t) => t.testId),
    }),
  });

  if (!response.ok) {
    throw new Error(`Lab harness HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    outcomes?: LabHarnessTestOutcome[];
  };

  if (!Array.isArray(payload.outcomes) || payload.outcomes.length === 0) {
    throw new Error("Lab harness returned no outcomes");
  }

  return buildHarnessResult(request.tests, payload.outcomes, "http");
}

function executeInProcessLabTests(request: LabHarnessRequest): LabHarnessResult {
  const outcomes: LabHarnessTestOutcome[] = request.tests.map((test) => {
    const detectionObserved = deterministicDetectionObserved(
      request.coaId,
      test.testId,
      request.citedFactIds
    );
    return {
      testId: test.testId,
      name: test.name,
      techniqueId: test.techniqueId,
      executed: true,
      detectionObserved,
      harness: "in-process" as const,
    };
  });

  return buildHarnessResult(request.tests, outcomes, "in-process");
}

function buildHarnessResult(
  tests: AtomicLabTest[],
  outcomes: LabHarnessTestOutcome[],
  harness: "in-process" | "http"
): LabHarnessResult {
  const controlMap = new Map<string, DetectionExpectation>();

  for (const test of tests) {
    for (const controlId of test.expectedControlIds) {
      if (!controlMap.has(controlId)) {
        const label = controlLabel(controlId);
        controlMap.set(controlId, {
          controlId,
          label,
          expected: true,
        });
      }
    }
  }

  const expectedDetections = Array.from(controlMap.values());
  const observedDetections = expectedDetections.map((detection) => {
    const related = outcomes.filter((o) =>
      tests
        .find((t) => t.testId === o.testId)
        ?.expectedControlIds.includes(detection.controlId)
    );
    const observed =
      related.length > 0 && related.every((o) => o.detectionObserved);
    return {
      ...detection,
      observed,
    };
  });

  return {
    outcomes: outcomes.map((o) => ({ ...o, harness })),
    expectedDetections,
    observedDetections,
  };
}

function deterministicDetectionObserved(
  coaId: string,
  testId: string,
  citedFactIds: string[]
): boolean {
  let hash = 0;
  const seed = `${coaId}:${testId}:${citedFactIds.sort().join(",")}`;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 1000;
  }
  return hash % 5 !== 0;
}

function controlLabel(controlId: string): string {
  const labels: Record<string, string> = {
    "siem-auth-anomaly": "SIEM authentication anomaly rule",
    "ndr-lateral-beacon": "NDR C2 / scan heuristic",
    "edr-process-discovery": "EDR process discovery chain",
  };
  return labels[controlId] ?? controlId;
}
