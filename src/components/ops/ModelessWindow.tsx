import { useRef, useState, type ReactNode } from "react";
import styles from "../../App.module.css";

type DragMode = "move" | "resize-w" | "resize-h";

export type ModelessWindowProps = {
  title: string;
  open: boolean;
  minimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
  onClose: () => void;
  defaultPosition?: { x: number; y: number };
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  zIndex?: number;
  children: ReactNode;
};

export function ModelessWindow({
  title,
  open,
  minimized = false,
  onMinimizedChange,
  onClose,
  defaultPosition = { x: 160, y: 200 },
  defaultWidth = 420,
  defaultHeight = 320,
  minWidth = 280,
  maxWidth = 920,
  minHeight = 140,
  maxHeight = 640,
  zIndex = 70,
  children,
}: ModelessWindowProps) {
  const [position, setPosition] = useState(defaultPosition);
  const [width, setWidth] = useState(defaultWidth);
  const [height, setHeight] = useState(defaultHeight);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
    mode: DragMode;
  } | null>(null);

  if (!open) return null;

  const startPointerDrag = (mode: DragMode) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (minimized && mode !== "move") return;
    event.preventDefault();
    if (mode !== "move") event.stopPropagation();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      originW: width,
      originH: height,
      mode,
    };

    const onMove = (moveEvent: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;
      if (state.mode === "move") {
        const nextX = Math.max(16, state.originX + (moveEvent.clientX - state.startX));
        const nextY = Math.max(72, state.originY + (moveEvent.clientY - state.startY));
        setPosition({ x: nextX, y: nextY });
        return;
      }
      if (state.mode === "resize-w") {
        const nextW = Math.max(minWidth, Math.min(maxWidth, state.originW + (moveEvent.clientX - state.startX)));
        setWidth(nextW);
        return;
      }
      const capH = Math.min(maxHeight, window.innerHeight - state.originY - 24);
      const nextH = Math.max(minHeight, Math.min(capH, state.originH + (moveEvent.clientY - state.startY)));
      setHeight(nextH);
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const toggleMinimized = () => onMinimizedChange?.(!minimized);

  return (
    <section
      className={`${styles.modelessWindow} ${minimized ? styles.modelessWindowMinimized : ""}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${width}px`,
        height: minimized ? undefined : `${height}px`,
        zIndex,
      }}
    >
      <div className={styles.modelessWindowHeader} onPointerDown={startPointerDrag("move")}>
        <strong>{title}</strong>
        <div className={styles.modelessWindowActions}>
          <button
            type="button"
            className={styles.modelessWindowAction}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleMinimized}
            title={minimized ? "Restore" : "Minimize"}
          >
            {minimized ? "▢" : "—"}
          </button>
          <button
            type="button"
            className={styles.modelessWindowAction}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>
      {!minimized && (
        <>
          <div className={styles.modelessWindowBody}>{children}</div>
          <div
            className={styles.modelessResizeEast}
            onPointerDown={startPointerDrag("resize-w")}
            title="Drag to resize width"
          />
          <div
            className={styles.modelessResizeSouth}
            onPointerDown={startPointerDrag("resize-h")}
            title="Drag to resize height"
          />
        </>
      )}
    </section>
  );
}
