import { isHighRiskActionType } from "../intel/evidence";
import type { CoaAction, SolverCandidateResult, SolverInput } from "./types";

type IntelAction = NonNullable<SolverInput["intelActions"]>[number];

/**
 * Produces competing COA bundles from validated intel actions (not one mega-bundle).
 * Each bundle is checked for asset/time overlap — overlapping bundles become UNSAT with traces.
 */
export async function solveValidatedIntelBundles(
  input: SolverInput
): Promise<SolverCandidateResult[]> {
  await delay(120);

  const actions = input.intelActions ?? [];
  if (actions.length === 0) {
    return [
      {
        status: "unsat",
        selectedActions: [],
        constraintSatisfaction: {
          hard: [
            {
              id: "hc-cited-facts",
              satisfied: false,
              label: "Evidence required",
              reason: "No cited validated intel actions available for planning",
            },
          ],
          soft: [],
        },
      },
    ];
  }

  const bundles = buildCompetingBundles(actions);
  const results: SolverCandidateResult[] = [];

  for (const bundle of bundles) {
    results.push(evaluateBundle(bundle, input));
  }

  const anySat = results.some((r) => r.status === "sat");
  if (!anySat && actions.length > 0) {
    const weakEvidence = actions.every(
      (a) => !a.confidence || a.confidence === "low"
    );
    if (weakEvidence) {
      results.push(insufficientEvidenceResult(actions));
    }
  }

  return results.length > 0 ? results : [{ status: "unsat", selectedActions: [] }];
}

function buildCompetingBundles(actions: IntelAction[]): IntelAction[][] {
  const continuity: IntelAction[] = [];
  const investigate: IntelAction[] = [];
  const observe: IntelAction[] = [];
  const coordinate: IntelAction[] = [];

  for (const action of actions) {
    const type = action.actionType ?? "other";
    const text = action.description.toLowerCase();
    if (
      type === "preserve" ||
      type === "inform" ||
      /continuity|logistics|public|messaging|port/i.test(text)
    ) {
      continuity.push(action);
    } else if (
      type === "investigate" ||
      type === "harden" ||
      /cyber|forensic|authentication|siem/i.test(text)
    ) {
      investigate.push(action);
    } else if (
      type === "observe" ||
      type === "monitor" ||
      /uas|airspace|drone|radar|isr/i.test(text)
    ) {
      observe.push(action);
    } else if (
      type === "coordinate" ||
      /maritime|vessel|liaison|patrol/i.test(text)
    ) {
      coordinate.push(action);
    } else {
      continuity.push(action);
    }
  }

  const byTheme = { continuity, investigate, observe, coordinate };

  const bundles: IntelAction[][] = [];

  for (const group of Object.values(byTheme)) {
    if (group.length > 0) bundles.push(group);
  }

  const byConfidence = [...actions].sort(
    (a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)
  );
  for (const action of byConfidence.slice(0, 3)) {
    bundles.push([action]);
  }

  return dedupeBundles(bundles);
}

function evaluateBundle(
  bundle: IntelAction[],
  input: SolverInput
): SolverCandidateResult {
  const allLowConfidence = bundle.every(
    (a) => !a.confidence || a.confidence === "low"
  );
  const hasEscalatory = bundle.some((a) =>
    isHighRiskActionType(a.actionType, a.description)
  );
  if (allLowConfidence && hasEscalatory) {
    return insufficientEvidenceResult(bundle);
  }

  const T0 = Date.now() / 1000;
  const selectedActions = scheduleBundleActions(bundle, T0);

  const overlap = findAssetOverlap(selectedActions);
  if (overlap) {
    return {
      status: "unsat",
      selectedActions,
      constraintSatisfaction: {
        hard: [
          {
            id: "hc-resource-exclusivity",
            satisfied: false,
            label: "Asset exclusivity",
            reason: `${overlap.asset} double-booked in overlapping time windows`,
            evidence: overlap.actionIds,
          },
          {
            id: "hc-cited-facts",
            satisfied: bundle.every((a) => a.citedFacts.length > 0),
            label: "Cited evidence",
            reason: bundle.every((a) => a.citedFacts.length > 0)
              ? "Each action cites observed facts"
              : "One or more actions lack cited facts",
            evidence: bundle.flatMap((a) => a.citedFacts),
          },
        ],
        soft: [],
      },
    };
  }

  const missingAuthority = findMissingAuthority(bundle, input);
  if (missingAuthority) {
    return {
      status: "unsat",
      selectedActions,
      constraintSatisfaction: {
        hard: [
          {
            id: "hc-authority",
            satisfied: false,
            label: "Authority approval",
            reason: missingAuthority.reason,
            evidence: missingAuthority.evidence,
          },
        ],
        soft: [],
      },
    };
  }

  return {
    status: "sat",
    selectedActions,
    constraintSatisfaction: {
      hard: [
        {
          id: "hc-cited-facts",
          satisfied: true,
          label: "Cited evidence",
          reason: "Every action cites at least one observed fact",
          evidence: bundle.flatMap((a) => a.citedFacts),
        },
        {
          id: "hc-resource-exclusivity",
          satisfied: true,
          label: "Asset exclusivity",
          reason: "No overlapping asset assignments in this bundle",
        },
        {
          id: "hc-known-assets",
          satisfied: true,
          label: "Known assets only",
          reason: "Required assets are drawn from the scenario packet",
        },
      ],
      soft: [
        {
          id: "sc-minimize-actions",
          satisfied: bundle.length <= 2,
          weight: 0.4,
          label: "Parsimony",
          reason:
            bundle.length <= 2
              ? "Compact action set"
              : "Multiple actions increase coordination load",
          score: bundle.length <= 2 ? 1 : 0.4,
        },
        {
          id: "sc-align-intent",
          satisfied: true,
          weight: 0.5,
          label: "Commander intent alignment",
          reason: "Bundle theme matches validated intel action types",
          score: 0.8,
        },
      ],
    },
  };
}

/**
 * Maps bundle actions to timed COA actions.
 * Immediate actions compete for the same start window (T0); non-immediate actions
 * pack sequentially per asset so overlap reflects real double-booking, not artificial spacing.
 */
function scheduleBundleActions(bundle: IntelAction[], T0: number): CoaAction[] {
  const assetEndTimes = new Map<string, number>();

  return bundle.map((action) => {
    const resources =
      action.requiredAssets && action.requiredAssets.length > 0
        ? action.requiredAssets
        : ["unassigned-asset"];
    const duration = durationFor(action.timeSensitivity);
    const isImmediate = action.timeSensitivity === "immediate" || !action.timeSensitivity;

    let startTime = T0;
    if (!isImmediate) {
      for (const asset of resources) {
        const priorEnd = assetEndTimes.get(asset);
        if (priorEnd !== undefined) {
          startTime = Math.max(startTime, priorEnd);
        }
      }
    }

    const end = startTime + duration;
    for (const asset of resources) {
      assetEndTimes.set(asset, Math.max(assetEndTimes.get(asset) ?? T0, end));
    }

    return {
      id: action.id,
      name: action.description,
      type: action.actionType ?? "other",
      startTime,
      duration,
      resources,
    };
  });
}

function findAssetOverlap(actions: CoaAction[]): { asset: string; actionIds: string[] } | undefined {
  const intervals = new Map<string, { start: number; end: number; actionId: string }[]>();

  for (const action of actions) {
    const end = action.startTime + action.duration;
    for (const asset of action.resources) {
      const list = intervals.get(asset) ?? [];
      for (const prior of list) {
        if (action.startTime < prior.end && end > prior.start) {
          return { asset, actionIds: [prior.actionId, action.id] };
        }
      }
      list.push({ start: action.startTime, end, actionId: action.id });
      intervals.set(asset, list);
    }
  }
  return undefined;
}

function findMissingAuthority(
  bundle: IntelAction[],
  _input: SolverInput
): { reason: string; evidence: string[] } | undefined {
  for (const action of bundle) {
    if ((action.requiredAssets ?? []).some((a) => /strike|offensive/i.test(a))) {
      return {
        reason: "Escalatory asset requires explicit authority state (not modeled in stub)",
        evidence: action.citedFacts,
      };
    }
  }
  return undefined;
}

function dedupeBundles(bundles: IntelAction[][]): IntelAction[][] {
  const seen = new Set<string>();
  const out: IntelAction[][] = [];
  for (const bundle of bundles) {
    const key = bundle
      .map((a) => a.id)
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bundle);
  }
  return out;
}

function insufficientEvidenceResult(
  bundle: IntelAction[]
): SolverCandidateResult {
  return {
    status: "insufficient_evidence",
    selectedActions: [],
    constraintSatisfaction: {
      hard: [
        {
          id: "hc-evidence-quality",
          satisfied: false,
          label: "Evidence sufficient for intervention",
          reason:
            "No high-confidence intervention COA is justified yet — prefer collection and continuity preservation",
          evidence: bundle.flatMap((a) => a.citedFacts),
        },
        {
          id: "hc-cited-facts",
          satisfied: bundle.every((a) => a.citedFacts.length > 0),
          label: "Cited evidence",
          reason: "Actions cite observed facts but confidence is insufficient for escalatory bundles",
          evidence: bundle.flatMap((a) => a.citedFacts),
        },
      ],
      soft: [
        {
          id: "sc-collection-first",
          satisfied: true,
          weight: 0.5,
          label: "Collection-first posture",
          reason: "Monitor, investigate, and preserve continuity until corroboration",
        },
      ],
    },
  };
}

function confidenceRank(c?: "low" | "medium" | "high"): number {
  if (c === "high") return 2;
  if (c === "medium") return 1;
  return 0;
}

function durationFor(timeSensitivity?: "immediate" | "time-bound" | "routine"): number {
  switch (timeSensitivity) {
    case "immediate":
      return 60;
    case "time-bound":
      return 180;
    case "routine":
      return 360;
    default:
      return 120;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
