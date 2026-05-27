import { useEffect, useRef, useState } from "react";
import styles from "../../App.module.css";

export type OpsWindowId = "timeline" | "orders" | "coa" | "commanderMatrix";

export type OpsWindowState = {
  open: boolean;
  minimized: boolean;
};

export type OpsWindowsState = Record<OpsWindowId, OpsWindowState>;

const WINDOW_LABELS: Record<OpsWindowId, string> = {
  timeline: "Event Timeline",
  orders: "Show Orders",
  coa: "COA Planning",
  commanderMatrix: "Commander's Matrix",
};

type WindowsMenuProps = {
  windows: OpsWindowsState;
  onShowWindow: (id: OpsWindowId) => void;
  onHideWindow: (id: OpsWindowId) => void;
  onToggleMinimized: (id: OpsWindowId) => void;
};

export function WindowsMenu({
  windows,
  onShowWindow,
  onHideWindow,
  onToggleMinimized,
}: WindowsMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.windowsMenuWrap} ref={menuRef}>
      <button
        type="button"
        className={open ? styles.headerButtonActive : styles.headerButton}
        onClick={() => setOpen((value) => !value)}
      >
        Windows
      </button>
      {open && (
        <div className={styles.windowsMenuPanel} role="menu">
          <div className={styles.windowsMenuTitle}>Operational windows</div>
          {(Object.keys(WINDOW_LABELS) as OpsWindowId[]).map((id) => {
            const state = windows[id];
            const status = !state.open
              ? "Closed"
              : state.minimized
                ? "Minimized"
                : "Open";
            return (
              <div key={id} className={styles.windowsMenuRow}>
                <button
                  type="button"
                  className={styles.windowsMenuLabel}
                  role="menuitem"
                  onClick={() => {
                    if (!state.open || state.minimized) onShowWindow(id);
                    else onHideWindow(id);
                    setOpen(false);
                  }}
                >
                  <span className={state.open && !state.minimized ? styles.windowsMenuCheck : styles.windowsMenuCheckOff}>
                    {state.open && !state.minimized ? "✓" : ""}
                  </span>
                  {WINDOW_LABELS[id]}
                </button>
                <span className={styles.windowsMenuStatus}>{status}</span>
                {state.open && (
                  <button
                    type="button"
                    className={styles.windowsMenuMini}
                    onClick={() => onToggleMinimized(id)}
                  >
                    {state.minimized ? "Restore" : "Min"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function defaultOpsWindowsState(): OpsWindowsState {
  return {
    timeline: { open: true, minimized: false },
    orders: { open: false, minimized: false },
    coa: { open: false, minimized: false },
    commanderMatrix: { open: false, minimized: false },
  };
}
