import { useCallback, useRef, useState, type ReactNode } from "react";
import { LogisticsMatrix } from "@components/LogisticsMatrix";
import type { LogisticsChip } from "@coa/types";
import type { LogisticsEmptyContext } from "@components/LogisticsMatrix";
import type { useDisplayedPlan } from "@coa/store";
import styles from "../../App.module.css";

type Props = {
  map: ReactNode;
  displayedPlan: ReturnType<typeof useDisplayedPlan>;
  selectedCoaLabel?: string;
  selectedChipId?: string;
  onChipSelect?: (chip: LogisticsChip) => void;
  emptyContext?: LogisticsEmptyContext;
  defaultLogisticsHeight?: number;
  minLogisticsHeight?: number;
  minMapHeight?: number;
};

export function MapLogisticsStack({
  map,
  displayedPlan,
  selectedCoaLabel,
  selectedChipId,
  onChipSelect,
  emptyContext,
  defaultLogisticsHeight = 240,
  minLogisticsHeight = 120,
  minMapHeight = 200,
}: Props) {
  const [logisticsHeight, setLogisticsHeight] = useState(defaultLogisticsHeight);
  const stackRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = logisticsHeight;

      const onMove = (ev: PointerEvent) => {
        const delta = startY - ev.clientY;
        const containerH = stackRef.current?.offsetHeight ?? 800;
        const maxLogistics = containerH - minMapHeight - 6;
        const next = Math.max(
          minLogisticsHeight,
          Math.min(startH + delta, maxLogistics)
        );
        setLogisticsHeight(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [logisticsHeight, minLogisticsHeight, minMapHeight]
  );

  const sceneHint =
    displayedPlan.kind === "populated"
      ? "Click a highlighted logistics action to focus linked scene contacts."
      : undefined;

  return (
    <div className={styles.opsCenterStack} ref={stackRef}>
      <div className={styles.opsMapSlot}>{map}</div>

      <div
        className={styles.opsRowHandle}
        onPointerDown={startDrag}
        title="Drag to resize map and logistics"
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={logisticsHeight}
      />

      <section
        className={styles.opsLogisticsDock}
        style={{ height: logisticsHeight, flexShrink: 0 }}
        aria-label="Logistics matrix"
      >
        <h3 className={styles.dashboardTitle}>
          Logistics Matrix
          {selectedCoaLabel && (
            <span className={styles.coaNote}> — {selectedCoaLabel}</span>
          )}
        </h3>
        {sceneHint && <p className={styles.panelHint}>{sceneHint}</p>}
        <div className={styles.logisticsMatrixHostDock}>
          <LogisticsMatrix
            plan={displayedPlan}
            allowDemo
            selectedChipId={selectedChipId}
            onChipSelect={onChipSelect}
            emptyContext={emptyContext}
          />
        </div>
      </section>
    </div>
  );
}
