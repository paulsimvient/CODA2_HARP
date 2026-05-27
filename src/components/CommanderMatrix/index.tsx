import { buildMatrixDerivation, type MatrixRowId } from "@coa/matrixDerivation";
import type { CoaCandidate } from "@coa/types";
import type { DecisionPoint } from "../../intel/types";
import {
  ConstraintTracePanel,
  EvidenceConflictsPanel,
  RankingSensitivityPanel,
  RunMetadataFooter,
} from "../coa/CoaAuditPanels";
import type { EvidenceConflict } from "../../intel/evidence";
import type { RankingSensitivity } from "@coa/types";
import styles from "./CommanderMatrix.module.css";

type MatrixColumn = {
  id: string;
  label: string;
  subtitle?: string;
  coa?: CoaCandidate;
};

type CriterionRow = {
  id: MatrixRowId;
  label: string;
  format: (coa: CoaCandidate | undefined) => string;
  className?: (coa: CoaCandidate | undefined) => string;
};

const STUB_COLUMNS: MatrixColumn[] = [
  { id: "monitor", label: "Monitor", subtitle: "Hold posture" },
  { id: "retask-isr", label: "Re-task ISR", subtitle: "Surveillance" },
  { id: "escalate", label: "Escalate", subtitle: "Defensive" },
  { id: "interdict", label: "Interdict", subtitle: "Engage" },
];

type CommanderMatrixProps = {
  candidates: CoaCandidate[];
  selectedCoaId?: string;
  onSelectCoa?: (id: string) => void;
  commanderIntent?: string;
  decisionPoints?: DecisionPoint[];
  compact?: boolean;
  evidenceConflicts?: EvidenceConflict[];
  rankingSensitivity?: RankingSensitivity;
  runMetadata?: import("@coa/types").CoaRunMetadata;
  showAuditPanels?: boolean;
};

const CRITERIA: CriterionRow[] = [
  {
    id: "overall",
    label: "Overall",
    format: (coa) => (coa ? `${Math.round(coa.scores.overall * 100)}%` : "—"),
    className: (coa) => scoreClass(coa?.scores.overall ?? 0),
  },
  {
    id: "risk",
    label: "Risk",
    format: (coa) => (coa ? riskLabel(coa.scores.risk) : "—"),
    className: (coa) => riskClass(coa?.scores.risk ?? 0.5),
  },
  {
    id: "logistics",
    label: "Logistics",
    format: (coa) => (coa ? `${Math.round(coa.scores.logistics * 100)}%` : "—"),
    className: (coa) => scoreClass(coa?.scores.logistics ?? 0),
  },
  {
    id: "feasibility",
    label: "Feasibility",
    format: (coa) => (coa ? `${Math.round(coa.scores.feasibility * 100)}%` : "—"),
    className: (coa) => scoreClass(coa?.scores.feasibility ?? 0),
  },
  {
    id: "effects",
    label: "Effects",
    format: (coa) =>
      coa?.effects ? `${Math.round(coa.effects.expectedImpact * 100)}%` : coa ? "—" : "—",
    className: (coa) => scoreClass(coa?.effects?.expectedImpact ?? coa?.scores.effects ?? 0),
  },
  {
    id: "status",
    label: "Solver",
    format: (coa) => {
      if (!coa) return "—";
      if (coa.status === "unsat") return "UNSAT";
      if (coa.status === "insufficient_evidence") return "INSUFF.";
      if (coa.status === "error") return "ERR";
      return "SAT";
    },
    className: (coa) => {
      if (!coa) return styles.cellMuted ?? "";
      if (coa.status === "sat") return styles.cellHigh ?? "";
      return styles.cellLow ?? "";
    },
  },
  {
    id: "actions",
    label: "Actions",
    format: (coa) => (coa ? String(coa.selectedActions.length) : "—"),
    className: () => styles.cellMuted ?? "",
  },
];

export function CommanderMatrix({
  candidates,
  selectedCoaId,
  onSelectCoa,
  commanderIntent,
  decisionPoints = [],
  compact = false,
  evidenceConflicts = [],
  rankingSensitivity,
  runMetadata,
  showAuditPanels = true,
}: CommanderMatrixProps) {
  const hasCandidates = candidates.length > 0;
  const columns: MatrixColumn[] = hasCandidates
    ? candidates.map((coa) => ({
        id: coa.id,
        label: coa.label,
        subtitle: coa.effects
          ? `Impact ${Math.round(coa.effects.expectedImpact * 100)}%`
          : `${coa.selectedActions.length} actions`,
        coa,
      }))
    : STUB_COLUMNS;

  const commanderDecisions = decisionPoints.filter((dp) => dp.commanderLevel === "commander");
  const selectedCoa = candidates.find((c) => c.id === selectedCoaId);

  return (
    <div className={compact ? `${styles.wrap} ${styles.compact}` : styles.wrap}>
      {commanderIntent && (
        <div className={styles.intent}>
          <span className={styles.intentLabel}>Commander&apos;s intent</span>
          {commanderIntent}
        </div>
      )}

      <div className={styles.table}>
        <table>
          <thead>
            <tr>
              <th className={styles.criterionCol}>Criterion</th>
              {columns.map((col) => {
                const selected = selectedCoaId === col.id;
                const header = (
                  <div className={styles.colHeader}>
                    <strong>{col.label}</strong>
                    {col.subtitle && <span>{col.subtitle}</span>}
                  </div>
                );
                return (
                  <th key={col.id} className={selected ? styles.colSelected : undefined}>
                    {onSelectCoa && col.coa ? (
                      <button
                        type="button"
                        className={styles.colButton}
                        onClick={() => onSelectCoa(col.id)}
                        title={`Select ${col.label}`}
                      >
                        {header}
                      </button>
                    ) : (
                      header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {CRITERIA.map((row) => (
              <tr key={row.id}>
                <td className={styles.criterionCol}>{row.label}</td>
                {columns.map((col) => {
                  const selected = selectedCoaId === col.id;
                  const derivation = buildMatrixDerivation(col.coa, row.id);
                  const value = row.format(col.coa);
                  const cellClass = row.className?.(col.coa) ?? styles.cellMuted;
                  const auditTitle = [
                    derivation.explanation,
                    derivation.derivedFrom.length > 0
                      ? `Derived from: ${derivation.derivedFrom.join(", ")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n\n");
                  return (
                    <td
                      key={`${row.id}-${col.id}`}
                      className={selected ? `${styles.colSelected} ${cellClass}` : cellClass}
                      title={auditTitle}
                    >
                      {row.id === "status" && col.coa ? (
                        <span
                          className={
                            col.coa.status === "sat" ? styles.badgeSat : styles.badgeUnsat
                          }
                        >
                          {value}
                        </span>
                      ) : (
                        <span className={styles.auditableCell}>{value}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!hasCandidates && (
        <p className={styles.footerHint}>
          Stub COAs shown until pipeline completes. Run COA evaluation to populate scores.
        </p>
      )}

      {commanderDecisions.length > 0 && (
        <div className={styles.decisions}>
          <div className={styles.decisionsTitle}>
            Commander-level decisions ({commanderDecisions.length})
          </div>
          {commanderDecisions.slice(0, compact ? 2 : 5).map((dp) => (
            <div key={dp.id} className={styles.decisionRow}>
              <span>{dp.question}</span>
              <span className={styles.tier}>CMDR</span>
            </div>
          ))}
        </div>
      )}

      {showAuditPanels && !compact && (
        <>
          <EvidenceConflictsPanel conflicts={evidenceConflicts} />
          <ConstraintTracePanel candidate={selectedCoa} />
          <RankingSensitivityPanel sensitivity={rankingSensitivity} />
          <RunMetadataFooter metadata={runMetadata} />
        </>
      )}
    </div>
  );
}

function scoreClass(value: number): string {
  if (value >= 0.7) return styles.cellHigh ?? "";
  if (value >= 0.45) return styles.cellMid ?? "";
  return styles.cellLow ?? "";
}

function riskClass(value: number): string {
  if (value <= 0.35) return styles.cellHigh ?? "";
  if (value <= 0.6) return styles.cellMid ?? "";
  return styles.cellLow ?? "";
}

function riskLabel(value: number): string {
  if (value <= 0.35) return "LOW";
  if (value <= 0.6) return "MED";
  return "HIGH";
}
