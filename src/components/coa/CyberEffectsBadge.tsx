import type { CyberEffectsAnnotation } from "@coa/types";
import styles from "../../App.module.css";

type CyberEffectsBadgeProps = {
  cyberEffects: CyberEffectsAnnotation | undefined;
  compact?: boolean;
};

export function CyberEffectsBadge({ cyberEffects, compact }: CyberEffectsBadgeProps) {
  if (!cyberEffects) return null;

  const isSimulated = cyberEffects.executionMode === "simulated";
  const badgeClass = isSimulated ? styles.cyberSimBadge : styles.cyberLabBadge;
  const label = isSimulated ? "SIMULATED" : "LAB EXECUTED";
  const techniques = cyberEffects.techniquesEvaluated
    .map((t) => t.techniqueId)
    .slice(0, compact ? 2 : 4)
    .join(", ");

  return (
    <div className={styles.cyberEffectsBlock}>
      <span className={badgeClass} title={cyberEffects.explanation}>
        {label}
      </span>
      {!compact && (
        <span className={styles.cyberEffectsMeta}>
          {cyberEffects.provider} · residual risk{" "}
          {Math.round(cyberEffects.residualRisk * 100)}%
          {techniques ? ` · ${techniques}` : ""}
          {cyberEffects.atomicTestsExecuted && cyberEffects.atomicTestsExecuted.length > 0
            ? ` · ${cyberEffects.atomicTestsExecuted.length} atomic test(s)`
            : ""}
        </span>
      )}
      {!compact &&
        cyberEffects.atomicTestsExecuted?.map((test) => (
          <span key={test.testId} className={styles.cyberEffectsMeta}>
            {test.testId}: {test.detectionObserved ? "detected" : "not detected"} (
            {test.harness})
          </span>
        ))}
    </div>
  );
}
