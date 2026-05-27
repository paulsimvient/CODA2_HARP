// ─── Identifiers ─────────────────────────────────────────────────────────────

export type CoaId = string;
export type ActionId = string;
export type RunId = string;
export type SignalId = string;

// ─── Actions ─────────────────────────────────────────────────────────────────

export type CoaAction = {
  id: ActionId;
  name: string;
  type: string;
  /** Absolute start time in seconds from T0 */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Resource identifiers consumed by this action */
  resources: readonly string[];
};

// ─── Signals ─────────────────────────────────────────────────────────────────

export type Signal = {
  id: SignalId;
  type: string;
  value: unknown;
  timestamp: number;
  /** Originating intel fact ID, if this signal came from the intel layer */
  factId?: string;
};

// ─── Logistics ───────────────────────────────────────────────────────────────

export type LogisticsChip = {
  id: string;
  actionId: ActionId;
  label: string;
  laneId: string;
  /** Offset in seconds from T0 */
  startOffset: number;
  /** Duration in seconds */
  duration: number;
  /** IDs of chips this chip depends on */
  dependencies: string[];
  /** Grounded facts supporting this logistics action (map + orders linkage). */
  citedFactIds?: string[];
  linkedFactIds?: string[];
  resourceIds?: string[];
  actionType?: string;
  sceneEntities?: string[];
  sceneDomains?: string[];
  sceneSummary?: string;
};

export type LogisticsLane = {
  id: string;
  label: string;
  /** Ordered chip IDs belonging to this lane */
  chipIds: string[];
};

export type PlanSource = "validated-intel" | "demo";

export type LogisticsPlan =
  | { kind: "empty"; reason: "no-actions" | "unsat" | "not-built" }
  | {
      kind: "populated";
      source: PlanSource;
      /** The COA this plan belongs to — must match CoaCandidate.id */
      coaId: CoaId;
      lanes: LogisticsLane[];
      chips: LogisticsChip[];
      /** Total plan duration in seconds */
      totalDuration: number;
    };

// ─── Effects ─────────────────────────────────────────────────────────────────

export type CyberEffectsAnnotation = {
  provider: import("./cyberEmulation/types").CyberEmulationProvider;
  executionMode: import("./cyberEmulation/types").CyberEmulationExecutionMode;
  residualRisk: number;
  confidence: number;
  techniquesEvaluated: import("./cyberEmulation/types").AttckTechniqueRef[];
  evidenceRefs: string[];
  validatedActionIds: string[];
  citedFactIds: string[];
  explanation: string;
  atomicTestsExecuted?: import("./cyberEmulation/types").AtomicTestExecution[];
};

export type EffectsSummary = {
  expectedImpact: number;
  confidence: number;
  /** Estimated time in seconds until effects are realized */
  timeToEffect: number;
  explanation: string;
  risks: string[];
  /** Present when cyber-relevant actions were evaluated via the emulation adapter. */
  cyberEffects?: CyberEffectsAnnotation;
};

export type EffectsResult = {
  /** References an existing CoaCandidate.id — never creates a new one */
  coaId: CoaId;
  summary: EffectsSummary;
  score: number;
  risk: number;
  explanation: string;
};

// ─── Scores ──────────────────────────────────────────────────────────────────

export type CoaScores = {
  feasibility: number;
  logistics: number;
  effects: number;
  risk: number;
  overall: number;
};

export type IntelFidelityScore = {
  urgency: number;
  confidence: number;
  resourcePressure: number;
  alignment: number;
  effectsAdjustment: number;
  riskAdjustment: number;
  focusTypes: string[];
  matchedActionTypes: string[];
};

// ─── COA Candidate ───────────────────────────────────────────────────────────

/**
 * The single canonical object for a course of action.
 *
 * This type is the source of truth. It owns:
 *   - its selected actions (from the solver)
 *   - its logistics plan (from the logistics builder)
 *   - its effects annotation (from the effects engine)
 *   - its scores (derived from all of the above)
 *
 * No separate global logistics state should exist.
 * Effects annotate this object; they do not replace it.
 */
export type ConstraintTrace = {
  hard: {
    id: string;
    label: string;
    satisfied: boolean;
    reason: string;
    evidence?: string[];
  }[];
  soft: {
    id: string;
    label: string;
    score: number;
    weight: number;
    reason: string;
  }[];
};

export type RankingExplanation = {
  coaId: CoaId;
  rank: number;
  totalScore: number;
  components: {
    feasibility: number;
    effects: number;
    logistics: number;
    risk: number;
    intelFidelity?: number;
    parsimony: number;
  };
  tieBreakersApplied: string[];
  reason: string;
};

export type CoaRunMetadata = {
  scenarioId?: string;
  scenarioVersion?: string;
  constraintsVersion: string;
  scoringVersion: string;
  solverVersion: string;
  generatedAt: string;
  cyberEmulationProvider?: import("./cyberEmulation/types").CyberEmulationProvider;
  cyberEmulationExecutionMode?: import("./cyberEmulation/types").CyberEmulationExecutionMode;
};

export type RankingSensitivity = {
  confidence: "high" | "medium" | "low";
  reason: string;
  fragilePairs: Array<{
    leaderId: CoaId;
    challengerId: CoaId;
    flipCondition: string;
    scoreGap: number;
  }>;
};

export type CoaCandidate = {
  id: CoaId;
  runId: RunId;
  status: "sat" | "unsat" | "error" | "insufficient_evidence";
  label: string;
  selectedActions: CoaAction[];
  /**
   * Owned by this candidate. If status is "sat" and selectedActions.length > 0,
   * this must be kind "populated". See assertCoaState.
   */
  logisticsPlan: LogisticsPlan;
  /**
   * Populated after effects analysis runs. Undefined until then.
   * Effects engine writes here, never to logisticsPlan.
   */
  effects?: EffectsSummary;
  intelFidelity?: IntelFidelityScore;
  constraintTrace?: ConstraintTrace;
  dominatedBy?: CoaId;
  rankingExplanation?: RankingExplanation;
  scores: CoaScores;
};

// ─── Pipeline State ───────────────────────────────────────────────────────────

/**
 * The entire COA pipeline state. This is what the UI reads from.
 * The UI must never read from any separate logisticsTrailPlan.
 * The matrix renders from:
 *   candidatesById[selectedCoaId].logisticsPlan
 */
export type CoaState = {
  activeRunId?: RunId;
  candidatesById: Record<CoaId, CoaCandidate>;
  /** Ordered list of COA IDs, ranked best-first */
  candidateOrder: CoaId[];
  selectedCoaId?: CoaId;
  status: "idle" | "running" | "ready" | "error";
  error?: string;
  runMetadata?: CoaRunMetadata;
  /** Evidence-quality flags from normalized facts (deterministic, not LLM). */
  evidenceConflicts?: import("../intel/evidence").EvidenceConflict[];
  /** Whether top-ranked SAT COAs are fragile to scoring-weight changes. */
  rankingSensitivity?: RankingSensitivity;
};

// ─── Solver I/O ──────────────────────────────────────────────────────────────

export type SolverInput = {
  runId: RunId;
  signals: Signal[];
  mode: "validated-intel" | "demo";
  intelActions?: NonNullable<PipelineInput["intelActions"]>;
};

export type SolverConstraintHard = {
  id: string;
  satisfied: boolean;
  label?: string;
  reason?: string;
  evidence?: string[];
};

export type SolverConstraintSoft = {
  id: string;
  satisfied: boolean;
  weight: number;
  label?: string;
  reason?: string;
  score?: number;
};

export type SolverCandidateResult = {
  status: "sat" | "unsat" | "error" | "insufficient_evidence";
  selectedActions: CoaAction[];
  constraintSatisfaction?: {
    hard: SolverConstraintHard[];
    soft: SolverConstraintSoft[];
  };
};

export type SolverFn = (input: SolverInput) => Promise<SolverCandidateResult[]>;

// ─── Effects I/O ─────────────────────────────────────────────────────────────

export type EffectsEngineContext = {
  intelActions?: PipelineInput["intelActions"];
  cyberEmulation?: import("./cyberEmulation/types").CyberEmulationRunOptions;
};

export type EffectsEngineFn = (
  candidates: CoaCandidate[],
  context?: EffectsEngineContext
) => Promise<Record<CoaId, EffectsResult>>;

// ─── Pipeline I/O ────────────────────────────────────────────────────────────

export type PipelineInput = {
  mode: "validated-intel" | "demo";
  signals?: Signal[];
  scenarioId?: string;
  scenarioVersion?: string;
  /** Normalized facts for evidence conflict detection and traceability. */
  observedFacts?: import("../intel/types").ObservedFact[];
  /**
   * Validated candidate actions from the intel layer.
   * These inform the solver about which action types are relevant to
   * the current situation. The solver still decides which combinations
   * are feasible — intel does not bypass the solver.
   */
  intelActions?: Array<{
    id: string;
    description: string;
    citedFacts: string[];
    actionType?:
      | "observe"
      | "monitor"
      | "investigate"
      | "coordinate"
      | "preserve"
      | "inform"
      | "harden"
      | "other";
    requiredAssets?: string[];
    timeSensitivity?: "immediate" | "time-bound" | "routine";
    confidence?: "low" | "medium" | "high";
  }>;
  /**
   * Optional cyber-effects adapter options (Phase 2 lab validation).
   * Requires human approval + lab confirmation for non-simulated providers.
   */
  cyberEmulation?: import("./cyberEmulation/types").CyberEmulationRunOptions;
};
