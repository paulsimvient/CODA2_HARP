import type { CyberEmulationProviderFn } from "../types";

function notImplemented(provider: string): CyberEmulationProviderFn {
  return async () => {
    throw new Error(
      `[cyber-emulation] Provider "${provider}" is not enabled in Phase 1. ` +
        "Use simulated provider or enable in a later phase with lab harness + human approval."
    );
  };
}

/** Phase 3 placeholder — CALDERA campaign emulation in controlled lab. */
export const calderaProvider = notImplemented("caldera");

/** Manual red-team assessment upload — no automated execution. */
export const manualAssessmentProvider = notImplemented("manual-assessment");
