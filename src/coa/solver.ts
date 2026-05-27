import { demoSolver } from "./demoSolver";
import type { SolverCandidateResult, SolverFn, SolverInput } from "./types";
import { solveValidatedIntelBundles } from "./validatedIntelSolver";

export type { SolverFn };

export const SOLVER_VERSION = "2.1.0-validated-bundles";

export const stubSolver: SolverFn = async (
  input: SolverInput
): Promise<SolverCandidateResult[]> => {
  if (input.mode === "validated-intel") {
    return solveValidatedIntelBundles(input);
  }
  return demoSolver(input);
};
