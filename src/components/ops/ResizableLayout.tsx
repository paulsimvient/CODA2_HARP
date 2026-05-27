import { useCallback, useRef, useState } from "react";
import styles from "./ResizableLayout.module.css";

type Props = {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
  /** initial widths in px; center gets remaining space */
  defaultLeft?: number;
  defaultRight?: number;
  minLeft?: number;
  minRight?: number;
  minCenter?: number;
};

export function ResizableLayout({
  left,
  center,
  right,
  defaultLeft = 280,
  defaultRight = 300,
  minLeft = 180,
  minRight = 200,
  minCenter = 320,
}: Props) {
  const [leftW, setLeftW] = useState(defaultLeft);
  const [rightW, setRightW] = useState(defaultRight);
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startLeft = leftW;
      const startRight = rightW;

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const containerW = containerRef.current?.offsetWidth ?? 1200;
        if (side === "left") {
          const next = Math.max(minLeft, Math.min(startLeft + delta, containerW - minRight - minCenter));
          setLeftW(next);
        } else {
          const next = Math.max(minRight, Math.min(startRight - delta, containerW - minLeft - minCenter));
          setRightW(next);
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [leftW, rightW, minLeft, minRight, minCenter]
  );

  return (
    <div className={styles.layout} ref={containerRef}>
      <div className={styles.pane} style={{ width: leftW, minWidth: minLeft, flexShrink: 0 }}>
        {left}
      </div>

      <div
        className={styles.handle}
        onPointerDown={startDrag("left")}
        title="Drag to resize"
      />

      <div className={styles.centerPane}>
        {center}
      </div>

      <div
        className={styles.handle}
        onPointerDown={startDrag("right")}
        title="Drag to resize"
      />

      <div className={styles.pane} style={{ width: rightW, minWidth: minRight, flexShrink: 0 }}>
        {right}
      </div>
    </div>
  );
}
