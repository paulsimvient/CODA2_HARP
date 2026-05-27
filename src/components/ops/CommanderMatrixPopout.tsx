import {
  useEvidenceConflicts,
  useRankingSensitivity,
  useRunMetadata,
} from "@coa/store";
import { CommanderMatrix } from "@components/CommanderMatrix";
import type { CoaCandidate } from "../../coa/types";
import type { DecisionPoint } from "../../intel/types";

export function CommanderMatrixPopout({
  candidates,
  selectedCoaId,
  onSelectCoa,
  commanderIntent,
  decisionPoints,
}: {
  candidates: CoaCandidate[];
  selectedCoaId: string | undefined;
  onSelectCoa: (id: string) => void;
  commanderIntent?: string;
  decisionPoints: DecisionPoint[];
}) {
  const evidenceConflicts = useEvidenceConflicts();
  const rankingSensitivity = useRankingSensitivity();
  const runMetadata = useRunMetadata();

  return (
    <CommanderMatrix
      candidates={candidates}
      selectedCoaId={selectedCoaId}
      onSelectCoa={onSelectCoa}
      commanderIntent={commanderIntent}
      decisionPoints={decisionPoints}
      evidenceConflicts={evidenceConflicts}
      rankingSensitivity={rankingSensitivity}
      runMetadata={runMetadata}
      showAuditPanels
    />
  );
}
