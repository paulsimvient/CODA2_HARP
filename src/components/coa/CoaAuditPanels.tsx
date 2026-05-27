import { formatConstraintTraces, unsatSummary } from "@coa/constraintTrace";
import type { CoaCandidate, RankingSensitivity } from "@coa/types";
import type { EvidenceConflict } from "../../intel/evidence";
import styles from "./CoaAuditPanels.module.css";

export function EvidenceConflictsPanel({
  conflicts,
}: {
  conflicts: EvidenceConflict[];
}) {
  if (conflicts.length === 0) {
    return (
      <section className={styles.panel}>
        <h4 className={styles.title}>Evidence quality</h4>
        <p className={styles.muted}>No deterministic evidence conflicts detected.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <h4 className={styles.title}>Evidence conflicts ({conflicts.length})</h4>
      <ul className={styles.list}>
        {conflicts.map((c) => (
          <li key={c.id} className={styles.conflictItem}>
            <div className={styles.conflictHead}>
              <span className={styles.badge}>{c.issue}</span>
              <span className={styles.effect}>{c.effect}</span>
            </div>
            <p className={styles.reason}>{c.reason}</p>
            <p className={styles.facts}>
              Facts: {c.facts.join(", ")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConstraintTracePanel({
  candidate,
}: {
  candidate: CoaCandidate | undefined;
}) {
  if (!candidate) {
    return (
      <section className={styles.panel}>
        <h4 className={styles.title}>Constraint trace</h4>
        <p className={styles.muted}>Select a COA to view hard/soft constraint evaluation.</p>
      </section>
    );
  }

  const trace = candidate.constraintTrace;
  if (!trace) {
    return (
      <section className={styles.panel}>
        <h4 className={styles.title}>Constraint trace — {candidate.label}</h4>
        <p className={styles.muted}>No constraint trace attached to this candidate.</p>
      </section>
    );
  }

  const hardLines = formatConstraintTraces(trace);
  const failed = trace.hard.filter((h) => !h.satisfied);

  return (
    <section className={styles.panel}>
      <h4 className={styles.title}>
        Constraint trace — {candidate.label}
        <span className={styles.statusTag}>{candidate.status.toUpperCase()}</span>
      </h4>
      {(candidate.status === "unsat" || candidate.status === "insufficient_evidence") && (
        <p className={styles.unsatLead}>
          {candidate.label} is {candidate.status === "unsat" ? "UNSAT" : "insufficient evidence"} because:{" "}
          <strong>{unsatSummary(trace)}</strong>
        </p>
      )}
      <div className={styles.subhead}>Hard constraints</div>
      <ul className={styles.list}>
        {hardLines.map((line) => (
          <li key={line} className={line.startsWith("✗") ? styles.fail : styles.pass}>
            {line}
          </li>
        ))}
      </ul>
      {failed.length === 0 && trace.hard.length > 0 && (
        <p className={styles.muted}>All hard constraints satisfied.</p>
      )}
      {trace.soft.length > 0 && (
        <>
          <div className={styles.subhead}>Soft preferences</div>
          <ul className={styles.list}>
            {trace.soft.map((s) => (
              <li key={s.id} className={styles.softItem}>
                <span>{s.label}</span>
                <span className={styles.softScore}>
                  score {Math.round(s.score * 100)}% · weight {s.weight}
                </span>
                <span className={styles.reason}>{s.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function RankingSensitivityPanel({
  sensitivity,
}: {
  sensitivity: RankingSensitivity | undefined;
}) {
  if (!sensitivity) {
    return (
      <section className={styles.panel}>
        <h4 className={styles.title}>Ranking sensitivity</h4>
        <p className={styles.muted}>Run COA evaluation to analyze rank stability.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <h4 className={styles.title}>
        Ranking sensitivity
        <span className={`${styles.confBadge} ${styles[`conf_${sensitivity.confidence}`]}`}>
          {sensitivity.confidence.toUpperCase()}
        </span>
      </h4>
      <p className={styles.reason}>{sensitivity.reason}</p>
      {sensitivity.fragilePairs.length > 0 && (
        <ul className={styles.list}>
          {sensitivity.fragilePairs.map((pair) => (
            <li key={`${pair.leaderId}-${pair.challengerId}`} className={styles.fragileItem}>
              {pair.flipCondition}
              <span className={styles.muted}>
                {" "}
                (gap {Math.round(pair.scoreGap * 100)} pts)
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RunMetadataFooter({
  metadata,
}: {
  metadata:
    | {
        scenarioId?: string;
        scenarioVersion?: string;
        constraintsVersion: string;
        scoringVersion: string;
        solverVersion: string;
        generatedAt: string;
      }
    | undefined;
}) {
  if (!metadata) return null;
  return (
    <footer className={styles.metaFooter}>
      <span>Scenario {metadata.scenarioId ?? "—"} v{metadata.scenarioVersion ?? "—"}</span>
      <span>Constraints {metadata.constraintsVersion}</span>
      <span>Scoring {metadata.scoringVersion}</span>
      <span>Solver {metadata.solverVersion}</span>
    </footer>
  );
}
