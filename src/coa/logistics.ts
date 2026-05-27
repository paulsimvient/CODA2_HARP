import type { ObservedFact } from "../intel/types";
import { createLaneId } from "./ids";
import {
  buildLogisticsSceneContext,
  enrichLogisticsChip,
  enrichLogisticsLaneLabel,
  type IntelActionContext,
} from "./logisticsScene";
import type {
  CoaAction,
  CoaId,
  LogisticsChip,
  LogisticsLane,
  LogisticsPlan,
  PlanSource,
} from "./types";

// ─── Logistics builder ────────────────────────────────────────────────────────

type BuildLogisticsPlanInput = {
  coaId: CoaId;
  actions: CoaAction[];
  source: PlanSource;
  intelActions?: IntelActionContext[];
  observedFacts?: ObservedFact[];
};

/**
 * Converts a COA's selected actions into a populated logistics plan.
 *
 * Lanes are grouped by the first resource of each action.
 * Each action becomes one chip in its lane.
 * Dependencies are computed from sequential actions sharing a resource.
 *
 * This runs synchronously — it is pure data transformation, not I/O.
 * It is called inside the pipeline after the solver returns, before any
 * state is committed.
 *
 * Rules enforced here:
 *   - If actions is empty, returns kind "empty" with reason "no-actions".
 *   - Every chip's laneId references a lane in the returned plan.
 *   - The returned plan's coaId matches the provided coaId.
 */
export function buildLogisticsPlan(
  input: BuildLogisticsPlanInput
): LogisticsPlan {
  const { coaId, actions, source, intelActions, observedFacts } = input;

  if (actions.length === 0) {
    return { kind: "empty", reason: "no-actions" };
  }

  const scene = buildLogisticsSceneContext(intelActions, observedFacts);
  const T0 = Math.min(...actions.map((a) => a.startTime));

  const laneMap = new Map<string, { lane: LogisticsLane; chips: LogisticsChip[] }>();

  for (const action of actions) {
    const resources = action.resources.length > 0 ? action.resources : ["general-asset"];
    for (const resource of resources) {
      const laneId = createLaneId(coaId, resource);

      if (!laneMap.has(laneId)) {
        laneMap.set(laneId, {
          lane: {
            id: laneId,
            label: enrichLogisticsLaneLabel(resource, scene),
            chipIds: [],
          },
          chips: [],
        });
      }

      const entry = laneMap.get(laneId)!;
      const chipId = `chip-${coaId}-${action.id}-${sanitizeForId(resource)}`;

      const prevChipId =
        entry.chips.length > 0
          ? entry.chips[entry.chips.length - 1]!.id
          : undefined;

      const baseChip: LogisticsChip = {
        id: chipId,
        actionId: action.id,
        label: action.name,
        laneId,
        startOffset: action.startTime - T0,
        duration: action.duration,
        dependencies: prevChipId ? [prevChipId] : [],
      };

      const chip = enrichLogisticsChip(baseChip, action, scene);

      entry.chips.push(chip);
      entry.lane.chipIds.push(chipId);
    }
  }

  // Cross-lane dependencies: later actions that cite overlapping facts depend on earlier chips.
  const chipsByAction = new Map<string, LogisticsChip[]>();
  for (const { chips } of laneMap.values()) {
    for (const chip of chips) {
      const list = chipsByAction.get(chip.actionId) ?? [];
      list.push(chip);
      chipsByAction.set(chip.actionId, list);
    }
  }

  const orderedActions = [...actions].sort((a, b) => a.startTime - b.startTime);
  for (let i = 1; i < orderedActions.length; i++) {
    const prev = orderedActions[i - 1]!;
    const curr = orderedActions[i]!;
    const prevFacts = new Set(
      chipsByAction.get(prev.id)?.flatMap((c) => c.linkedFactIds ?? []) ?? []
    );
    const currChips = chipsByAction.get(curr.id) ?? [];
    const prevChipIds =
      chipsByAction.get(prev.id)?.map((c) => c.id) ?? [];
    if (prevFacts.size === 0 || prevChipIds.length === 0) continue;

    for (const chip of currChips) {
      const sharesFact = (chip.linkedFactIds ?? []).some((id) => prevFacts.has(id));
      if (!sharesFact) continue;
      const merged = new Set([...chip.dependencies, ...prevChipIds]);
      chip.dependencies = Array.from(merged);
    }
  }

  const lanes: LogisticsLane[] = [];
  const chips: LogisticsChip[] = [];

  for (const { lane, chips: laneChips } of laneMap.values()) {
    lanes.push(lane);
    chips.push(...laneChips);
  }

  const span =
    Math.max(...chips.map((c) => c.startOffset + c.duration), 0) -
    Math.min(...chips.map((c) => c.startOffset), 0);
  const totalDuration = Math.max(span, Math.max(...chips.map((c) => c.duration), 1));

  const plan: LogisticsPlan = {
    kind: "populated",
    source,
    coaId,
    lanes,
    chips,
    totalDuration,
  };
  return assertSafePlan(plan);
}

// ─── Score logistics quality ──────────────────────────────────────────────────

/**
 * Returns a logistics score in [0, 1] based on plan properties.
 * Higher is better (fewer resource conflicts, shorter duration, fewer gaps).
 */
export function scoreLogisticsPlan(plan: LogisticsPlan): number {
  if (plan.kind !== "populated") return 0;

  const { chips, totalDuration, lanes } = plan;

  if (chips.length === 0) return 0;

  const totalActionTime = chips.reduce((sum, c) => sum + c.duration, 0);
  const density = totalActionTime / (totalDuration * lanes.length || 1);

  const parallelism = lanes.length / chips.length;

  return clamp(density * 0.6 + parallelism * 0.4, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const BLOCKED_TERMS = [
  "cyber strike",
  "strike",
  "blockade",
  "air superiority",
  "offensive",
  "kinetic",
  "c2 nodes",
];

function containsBlockedTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some((term) => lower.includes(term));
}

export function assertSafePlan(plan: LogisticsPlan): LogisticsPlan {
  if (plan.kind !== "populated" || plan.source !== "validated-intel") {
    return plan;
  }

  const unsafeChip = plan.chips.find((chip) => containsBlockedTerm(chip.label));
  const unsafeLane = plan.lanes.find((lane) => containsBlockedTerm(lane.label));

  if (unsafeChip || unsafeLane) {
    throw new Error(
      `Unsafe/demo COA label detected: ${unsafeChip?.label ?? unsafeLane?.label}`
    );
  }

  return plan;
}

function sanitizeForId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
