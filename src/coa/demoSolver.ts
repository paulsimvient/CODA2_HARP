import type { Signal, SolverCandidateResult, SolverFn, SolverInput } from "./types";
import { DEMO_ACTION_CATALOG } from "./demoActionCatalog";

export const demoSolver: SolverFn = async (
  input: SolverInput
): Promise<SolverCandidateResult[]> => {
  await simulatedDelay(600);

  const signalIntensity = deriveSignalIntensity(input.signals);
  const T0 = Date.now() / 1000;

  return [
    {
      status: "sat",
      selectedActions: [
        { ...DEMO_ACTION_CATALOG[0], startTime: T0 + 3600 },
        { ...DEMO_ACTION_CATALOG[4], startTime: T0 + 10800 },
        { ...DEMO_ACTION_CATALOG[6], startTime: T0 + 0 },
      ],
      constraintSatisfaction: {
        hard: [
          { id: "hc-air-superiority-before-strike", satisfied: true },
          { id: "hc-resource-exclusivity", satisfied: true },
        ],
        soft: [
          { id: "sc-minimize-collateral", satisfied: true, weight: 0.8 },
          { id: "sc-speed-of-effect", satisfied: false, weight: 0.4 },
        ],
      },
    },
    {
      status: "sat",
      selectedActions: [
        { ...DEMO_ACTION_CATALOG[1], startTime: T0 + 1800 },
        { ...DEMO_ACTION_CATALOG[3], startTime: T0 + 0 },
        { ...DEMO_ACTION_CATALOG[7], startTime: T0 + 3600 },
      ],
      constraintSatisfaction: {
        hard: [
          { id: "hc-air-superiority-before-strike", satisfied: true },
          { id: "hc-resource-exclusivity", satisfied: true },
        ],
        soft: [
          { id: "sc-minimize-collateral", satisfied: true, weight: 0.95 },
          { id: "sc-speed-of-effect", satisfied: true, weight: 0.6 },
        ],
      },
    },
    {
      status: "sat",
      selectedActions: [
        { ...DEMO_ACTION_CATALOG[0], startTime: T0 + 3600 },
        { ...DEMO_ACTION_CATALOG[1], startTime: T0 + 1800 },
        { ...DEMO_ACTION_CATALOG[2], startTime: T0 + 3600 },
        { ...DEMO_ACTION_CATALOG[3], startTime: T0 + 0 },
        { ...DEMO_ACTION_CATALOG[4], startTime: T0 + 14400 },
        { ...DEMO_ACTION_CATALOG[5], startTime: T0 + 7200 * signalIntensity },
      ],
      constraintSatisfaction: {
        hard: [
          { id: "hc-air-superiority-before-strike", satisfied: true },
          { id: "hc-resource-exclusivity", satisfied: true },
        ],
        soft: [
          { id: "sc-minimize-collateral", satisfied: false, weight: 0.7 },
          { id: "sc-speed-of-effect", satisfied: true, weight: 0.9 },
        ],
      },
    },
  ];
};

function simulatedDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveSignalIntensity(signals: Signal[]): number {
  if (signals.length === 0) return 1;
  return Math.min(signals.length / 5, 3);
}
