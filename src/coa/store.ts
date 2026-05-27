import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  deleteSqlSnapshot,
  loadSqlSnapshot,
  saveSqlSnapshot,
} from "../persistence/sqlState";
import { assertCoaState } from "./assertions";
import { EMPTY_DISPLAYED_PLAN } from "./logisticsConstants";
import {
  pickDefaultSelectedCoa,
  resolveDisplayedLogisticsPlan,
  runCoaPipeline,
  selectRankedCandidates,
  selectSelectedCoa,
} from "./pipeline";
import type { EvidenceConflict } from "../intel/evidence";
import type { CoaCandidate, CoaId, CoaState, LogisticsPlan, PipelineInput } from "./types";

// ─── Store shape ──────────────────────────────────────────────────────────────

type CoaStore = CoaState & {
  runPipeline: (input?: PipelineInput) => Promise<void>;
  selectCoa: (coaId: CoaId) => void;
  reset: () => void;
};

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: CoaState = {
  candidatesById: {},
  candidateOrder: [],
  status: "idle",
};
const COA_SQL_KEY = "coa_state";

export { EMPTY_DISPLAYED_PLAN, EMPTY_LOGISTICS_NOT_BUILT } from "./logisticsConstants";

/** Stable empty array — selectors must not allocate `[]` per subscription tick. */
export const EMPTY_EVIDENCE_CONFLICTS: EvidenceConflict[] = [];

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCoaStore = create<CoaStore>()((set, get) => ({
  ...INITIAL_STATE,

  runPipeline: async (input: PipelineInput = { mode: "validated-intel" }) => {
    set({ status: "running" });
    void persistCoaState({ ...get(), status: "running" });

    try {
      const nextState = await runCoaPipeline(input);
      set(nextState);
      void persistCoaState(nextState);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ status: "error", error: message });
      void persistCoaState({
        ...get(),
        status: "error",
        error: message,
      });
    }
  },

  selectCoa: (coaId: CoaId) => {
    const state = get();

    if (!state.candidatesById[coaId]) {
      console.warn(`[COA store] selectCoa: unknown coaId "${coaId}"`);
      return;
    }

    const next: CoaState = { ...state, selectedCoaId: coaId };
    assertCoaState(next);
    set({ selectedCoaId: coaId });
    void persistCoaState(next);
  },

  reset: () => {
    set(INITIAL_STATE);
    void deleteSqlSnapshot(COA_SQL_KEY);
  },
}));

// ─── React hooks ─────────────────────────────────────────────────────────────
//
// Selectors that return arrays or freshly allocated objects MUST use useShallow
// or return stable references. Otherwise React 18's useSyncExternalStore loops.

export function useDisplayedPlan(): LogisticsPlan | typeof EMPTY_DISPLAYED_PLAN {
  return useCoaStore((s) => resolveDisplayedLogisticsPlan(s));
}

export function useSelectedCoa(): CoaCandidate | undefined {
  return useCoaStore((s) => selectSelectedCoa(s));
}

export function useRankedCandidates(): CoaCandidate[] {
  return useCoaStore(useShallow((s) => selectRankedCandidates(s)));
}

export function usePipelineStatus(): CoaState["status"] {
  return useCoaStore((s) => s.status);
}

export function usePipelineError(): string | undefined {
  return useCoaStore((s) => s.error);
}

export function useRunPipeline() {
  return useCoaStore((s) => s.runPipeline);
}

export function useSelectCoa() {
  return useCoaStore((s) => s.selectCoa);
}

export function useResetCoa() {
  return useCoaStore((s) => s.reset);
}

export function useEvidenceConflicts(): EvidenceConflict[] {
  return useCoaStore((s) => s.evidenceConflicts ?? EMPTY_EVIDENCE_CONFLICTS);
}

export function useRankingSensitivity() {
  return useCoaStore((s) => s.rankingSensitivity);
}

export function useRunMetadata() {
  return useCoaStore((s) => s.runMetadata);
}

function sanitizeHydratedCoaState(state: CoaState): CoaState {
  const merged: CoaState = {
    ...INITIAL_STATE,
    ...state,
    status: state.status === "running" ? "idle" : state.status,
  };

  const ranked = selectRankedCandidates(merged);
  if (ranked.length === 0) return merged;

  const selected = merged.selectedCoaId
    ? merged.candidatesById[merged.selectedCoaId]
    : undefined;
  if (selected?.logisticsPlan.kind === "populated") return merged;

  const better = pickDefaultSelectedCoa(ranked);
  if (better?.logisticsPlan.kind === "populated") {
    return { ...merged, selectedCoaId: better.id };
  }

  return merged;
}

async function persistCoaState(state: CoaState): Promise<void> {
  await saveSqlSnapshot(COA_SQL_KEY, state);
}

async function hydrateCoaState(): Promise<void> {
  const snapshot = await loadSqlSnapshot<CoaState>(COA_SQL_KEY);
  if (!snapshot) return;
  useCoaStore.setState(sanitizeHydratedCoaState(snapshot));
}

void hydrateCoaState();
