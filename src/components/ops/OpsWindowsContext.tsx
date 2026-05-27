import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  defaultOpsWindowsState,
  type OpsWindowId,
  type OpsWindowsState,
} from "./WindowsMenu";

type OpsWindowsContextValue = {
  windows: OpsWindowsState;
  showWindow: (id: OpsWindowId) => void;
  hideWindow: (id: OpsWindowId) => void;
  toggleMinimized: (id: OpsWindowId) => void;
  setMinimized: (id: OpsWindowId, minimized: boolean) => void;
};

const OpsWindowsContext = createContext<OpsWindowsContextValue | null>(null);

export function OpsWindowsProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<OpsWindowsState>(defaultOpsWindowsState);

  const patchWindow = useCallback((id: OpsWindowId, patch: Partial<OpsWindowsState[OpsWindowId]>) => {
    setWindows((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }, []);

  const value = useMemo<OpsWindowsContextValue>(
    () => ({
      windows,
      showWindow: (id) => patchWindow(id, { open: true, minimized: false }),
      hideWindow: (id) => patchWindow(id, { open: false, minimized: false }),
      toggleMinimized: (id) =>
        setWindows((current) => ({
          ...current,
          [id]: {
            ...current[id],
            open: true,
            minimized: !current[id].minimized,
          },
        })),
      setMinimized: (id, minimized) => patchWindow(id, { open: true, minimized }),
    }),
    [patchWindow, windows]
  );

  return <OpsWindowsContext.Provider value={value}>{children}</OpsWindowsContext.Provider>;
}

export function useOpsWindows(): OpsWindowsContextValue {
  const value = useContext(OpsWindowsContext);
  if (!value) {
    throw new Error("useOpsWindows must be used within OpsWindowsProvider");
  }
  return value;
}

export function useOpsWindowsOptional(): OpsWindowsContextValue | null {
  return useContext(OpsWindowsContext);
}
