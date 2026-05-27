import type {
  CoaCandidate,
  LogisticsChip,
  LogisticsLane,
  LogisticsPlan,
} from "@coa/types";
import styles from "./LogisticsMatrix.module.css";

export type LogisticsEmptyContext = {
  pipelineStatus?: "idle" | "running" | "ready" | "error";
  selectedCoaLabel?: string;
  selectedCoaStatus?: CoaCandidate["status"];
  satCount?: number;
};

type LogisticsMatrixProps = {
  plan: LogisticsPlan | { kind: "empty"; reason: string };
  allowDemo?: boolean;
  selectedChipId?: string;
  onChipSelect?: (chip: LogisticsChip) => void;
  emptyContext?: LogisticsEmptyContext;
};

export function LogisticsMatrix({
  plan,
  allowDemo = false,
  selectedChipId,
  onChipSelect,
  emptyContext,
}: LogisticsMatrixProps) {
  if (plan.kind === "empty") {
    return <EmptyState reason={plan.reason} context={emptyContext} />;
  }

  if (plan.source !== "validated-intel" && !allowDemo) {
    return (
      <div className={styles.warningPanel}>
        DEMO COA DATA — NOT DERIVED FROM VALIDATED INTEL
      </div>
    );
  }

  const chipById = new Map(plan.chips.map((c) => [c.id, c]));
  const totalDuration = plan.totalDuration || 1;
  const linkedChipCount = plan.chips.filter(
    (c) => (c.linkedFactIds?.length ?? 0) > 0
  ).length;

  return (
    <div className={styles.matrix}>
      <div className={styles.header}>
        <TimeAxis totalDuration={totalDuration} />
      </div>
      <div className={styles.lanes}>
        {plan.lanes.map((lane) => (
          <Lane
            key={lane.id}
            lane={lane}
            chipById={chipById}
            totalDuration={totalDuration}
            selectedChipId={selectedChipId}
            onChipSelect={onChipSelect}
          />
        ))}
      </div>
      <div className={styles.footer}>
        <span className={styles.chipCount}>
          {plan.chips.length} action{plan.chips.length !== 1 ? "s" : ""}
          {linkedChipCount > 0 && ` · ${linkedChipCount} scene-linked`}
        </span>
        <span className={styles.duration}>
          Total: {formatDuration(totalDuration)}
        </span>
      </div>
    </div>
  );
}

function Lane({
  lane,
  chipById,
  totalDuration,
  selectedChipId,
  onChipSelect,
}: {
  lane: LogisticsLane;
  chipById: Map<string, LogisticsChip>;
  totalDuration: number;
  selectedChipId?: string;
  onChipSelect?: (chip: LogisticsChip) => void;
}) {
  return (
    <div className={styles.lane}>
      <div className={styles.laneLabel} title={lane.label}>
        {lane.label}
      </div>
      <div className={styles.laneTrack}>
        {lane.chipIds.map((chipId) => {
          const chip = chipById.get(chipId);
          if (!chip) return null;
          return (
            <Chip
              key={chip.id}
              chip={chip}
              totalDuration={totalDuration}
              selected={chip.id === selectedChipId}
              onSelect={onChipSelect}
            />
          );
        })}
      </div>
    </div>
  );
}

function Chip({
  chip,
  totalDuration,
  selected,
  onSelect,
}: {
  chip: LogisticsChip;
  totalDuration: number;
  selected: boolean;
  onSelect?: (chip: LogisticsChip) => void;
}) {
  const left = (chip.startOffset / totalDuration) * 100;
  const width = Math.max((chip.duration / totalDuration) * 100, 4);
  const hasSceneLink = (chip.linkedFactIds?.length ?? 0) > 0;
  const title = [
    chip.label,
    chip.actionType ? `Type: ${chip.actionType}` : "",
    chip.sceneSummary ? `Scene: ${chip.sceneSummary}` : "",
    chip.linkedFactIds?.length
      ? `Facts: ${chip.linkedFactIds.join(", ")}`
      : "No scene link",
    `Start: ${formatDuration(chip.startOffset)} · Duration: ${formatDuration(chip.duration)}`,
    chip.dependencies.length > 0
      ? `Depends on: ${chip.dependencies.length} chip(s)`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      className={
        selected
          ? `${styles.chip} ${styles.chipSelected}`
          : hasSceneLink
            ? `${styles.chip} ${styles.chipLinked}`
            : styles.chip
      }
      style={{ left: `${left}%`, width: `${width}%` }}
      title={title}
      onClick={() => onSelect?.(chip)}
      disabled={!onSelect}
    >
      <span className={styles.chipLabel}>{chip.label}</span>
      {hasSceneLink && chip.sceneDomains && chip.sceneDomains.length > 0 && (
        <span className={styles.chipTag}>{chip.sceneDomains[0]}</span>
      )}
    </button>
  );
}

function TimeAxis({ totalDuration }: { totalDuration: number }) {
  const ticks = 6;
  return (
    <div className={styles.timeAxis}>
      {Array.from({ length: ticks + 1 }, (_, i) => (
        <span key={i} className={styles.tick}>
          {formatDuration((totalDuration * i) / ticks)}
        </span>
      ))}
    </div>
  );
}

function emptyMessage(
  reason: string,
  context?: LogisticsEmptyContext
): { title: string; detail?: string } {
  if (reason === "not-built" || context?.pipelineStatus === "running") {
    return {
      title: "Building logistics plan…",
      detail: "The COA solver is still running.",
    };
  }
  if (context?.pipelineStatus === "idle") {
    return {
      title: "No logistics plan yet",
      detail:
        "Run COA Evaluation (COA Planning window or full pipeline) after intel validation completes.",
    };
  }
  if (reason === "unsat" || context?.selectedCoaStatus === "unsat") {
    return {
      title: "No schedule for this COA",
      detail:
        context?.selectedCoaLabel
          ? `${context.selectedCoaLabel} is UNSAT (infeasible). Select a feasible SAT COA in COA Planning.`
          : "The selected COA is infeasible. Pick another candidate or adjust constraints.",
    };
  }
  if (context?.selectedCoaStatus === "insufficient_evidence") {
    return {
      title: "Collection-only COA",
      detail: "This bundle has no executable logistics timeline — choose a SAT intervention COA.",
    };
  }
  if (reason === "no-coa-selected" && (context?.satCount ?? 0) > 0) {
    return {
      title: "Select a feasible COA",
      detail: `${context!.satCount} feasible candidate(s) exist — open COA Planning and select one marked SAT.`,
    };
  }
  const defaults: Record<string, string> = {
    "no-coa-selected": "Run COA evaluation, then select a SAT COA to populate the matrix.",
    "no-actions": "This COA has no scheduled actions.",
    unsat: "Solver returned UNSAT — no feasible logistics plan.",
    "not-built": "Logistics plan not built yet.",
  };
  return { title: defaults[reason] ?? "No logistics plan available" };
}

function EmptyState({
  reason,
  context,
}: {
  reason: string;
  context?: LogisticsEmptyContext;
}) {
  const { title, detail } = emptyMessage(reason, context);
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>—</div>
      <div className={styles.emptyMessage}>{title}</div>
      {detail && <p className={styles.emptyDetail}>{detail}</p>}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? `${m}m` : ""}`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}
