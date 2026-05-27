import type { ActionId, CoaId, RunId } from "./types";

// ─── Run IDs ─────────────────────────────────────────────────────────────────

let runCounter = 0;

/**
 * Creates a unique run ID for each pipeline invocation.
 * Monotonic and prefixed so log messages are scannable.
 */
export function createRunId(prefix = "run"): RunId {
  runCounter += 1;
  return `${prefix}-${Date.now()}-${runCounter}`;
}

// ─── COA IDs ─────────────────────────────────────────────────────────────────

/**
 * Creates a stable COA ID from a run ID and the sorted selected action IDs.
 *
 * "Stable" means: two solver results with the same run and same selected
 * actions will get the same COA ID. This is important so that effects results
 * (keyed by coaId) can always find their target candidate.
 *
 * If the same logical plan needs to survive across multiple runs, use
 * createSemanticCoaId instead.
 */
export function createStableCoaId(
  runId: RunId,
  selectedActions: Array<{ id: ActionId }>
): CoaId {
  const sortedActionIds = [...selectedActions]
    .map((a) => a.id)
    .sort()
    .join(",");
  return `coa-${runId}-${stableHash(sortedActionIds)}`;
}

/**
 * Creates a COA ID that is stable across multiple runs —
 * two candidates with the same selected actions always share an ID.
 * Useful when you want to track a "logical" COA across re-runs.
 */
export function createSemanticCoaId(
  selectedActions: Array<{ id: ActionId }>
): CoaId {
  const sortedActionIds = [...selectedActions]
    .map((a) => a.id)
    .sort()
    .join(",");
  return `coa-${stableHash(sortedActionIds)}`;
}

// ─── Chip / Lane IDs ─────────────────────────────────────────────────────────

export function createChipId(coaId: CoaId, actionId: ActionId): string {
  return `chip-${coaId}-${actionId}`;
}

export function createLaneId(coaId: CoaId, resource: string): string {
  return `lane-${coaId}-${stableHash(resource)}`;
}

// ─── Internal hash ───────────────────────────────────────────────────────────

/**
 * djb2-style hash. Not cryptographic — only used to produce short, stable
 * identifiers from string inputs.
 */
function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
