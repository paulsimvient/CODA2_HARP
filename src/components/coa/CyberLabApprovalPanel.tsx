import { useState } from "react";
import type { CoaRunMetadata } from "@coa/types";
import type { CyberEmulationRunOptions } from "../../coa/cyberEmulation";
import styles from "./CoaAuditPanels.module.css";

export type CyberLabApprovalState = {
  labEnvironmentConfirmed: boolean;
  humanApproved: boolean;
};

type CyberLabApprovalPanelProps = {
  disabled?: boolean;
  runMetadata?: CoaRunMetadata;
  onRunLabValidation: (options: CyberEmulationRunOptions) => void;
};

export function CyberLabApprovalPanel({
  disabled,
  runMetadata,
  onRunLabValidation,
}: CyberLabApprovalPanelProps) {
  const [labEnvironmentConfirmed, setLabEnvironmentConfirmed] = useState(false);
  const [humanApproved, setHumanApproved] = useState(false);

  const canRun =
    labEnvironmentConfirmed && humanApproved && !disabled;

  const lastRun =
    runMetadata?.cyberEmulationProvider === "atomic-red-team"
      ? "Last COA run used Atomic Red Team lab validation."
      : runMetadata?.cyberEmulationProvider === "simulated"
        ? "Last COA run used simulated cyber-effects only."
        : undefined;

  return (
    <section className={styles.panel}>
      <h4 className={styles.title}>Cyber lab validation (Phase 2)</h4>
      <p className={styles.muted}>
        Runs allowlisted Atomic-style checks in lab only. Requires explicit approval.
        Does not execute against production targets.
      </p>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={labEnvironmentConfirmed}
          onChange={(e) => setLabEnvironmentConfirmed(e.target.checked)}
          disabled={disabled}
        />
        <span>Lab environment confirmed (non-production targets only)</span>
      </label>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={humanApproved}
          onChange={(e) => setHumanApproved(e.target.checked)}
          disabled={disabled}
        />
        <span>I approve lab cyber-effects validation for this COA run</span>
      </label>
      <button
        type="button"
        className={styles.labRunButton}
        disabled={!canRun}
        onClick={() =>
          onRunLabValidation({
            provider: "atomic-red-team",
            humanApproved: true,
            labEnvironmentConfirmed: true,
          })
        }
      >
        Re-score COAs with lab validation
      </button>
      {lastRun && <p className={styles.muted}>{lastRun}</p>}
    </section>
  );
}
