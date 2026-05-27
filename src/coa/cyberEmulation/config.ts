import type { CyberEmulationProvider } from "./types";

/**
 * Global cyber-emulation policy. Lab-only and simulated-by-default.
 * Non-simulated providers remain disabled until explicitly enabled per phase.
 */
export const CYBER_EMULATION_CONFIG = {
  labOnly: true,
  defaultProvider: "simulated" as CyberEmulationProvider,
  enabledProviders: new Set<CyberEmulationProvider>([
    "simulated",
    "atomic-red-team",
  ]),
  /** No production target execution — requests must declare lab context for non-simulated runs. */
  forbidProductionExecution: true,
} as const;
