import { useEffect, useMemo, useRef, useState } from "react";
import { useEvidenceConflicts, useRankingSensitivity } from "@coa/store";
import { CommanderMatrix } from "@components/CommanderMatrix";
import { CommanderMatrixPopout } from "./CommanderMatrixPopout";
import {
  ConstraintTracePanel,
  EvidenceConflictsPanel,
  RankingSensitivityPanel,
} from "@components/coa/CoaAuditPanels";
import { CyberEffectsBadge } from "@components/coa/CyberEffectsBadge";
import { LogisticsMatrix } from "@components/LogisticsMatrix";
import { SituationalMap } from "@components/SituationalMap";
import type { DecisionPoint } from "../../intel/types";
import type { useDisplayedPlan } from "@coa/store";
import type { ObservedFact } from "../../intel/types";
import type { CoaCandidate, LogisticsChip } from "../../coa/types";
import { formatCoordLabel } from "../../scene/theater";
import type { MessageTrafficItem, OverviewTrack, ShowOrderItem } from "./types";
import { MapLogisticsStack } from "./MapLogisticsStack";
import { ResizableLayout } from "./ResizableLayout";
import { ModelessWindow } from "./ModelessWindow";
import { useOpsWindows, useOpsWindowsOptional } from "./OpsWindowsContext";
import { WindowsMenu } from "./WindowsMenu";
import { formatSimElapsed, SIM_TIME_SCALES } from "../../scene/kinematics";
import styles from "../../App.module.css";

type ActiveView =
  | "overview"
  | "simulation"
  | "signals"
  | "actions"
  | "coas"
  | "logistics"
  | "reports"
  | "trace";

type OpsHeaderProps = {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  simNowIso: string;
  simClockPaused: boolean;
  threatLevel: string;
  confidenceLevel: string;
  phase: string;
  summaryTime: string;
  environmentLabel: string;
  onToggleClockPaused: () => void;
  onRestartSim: () => void;
  onExportTrace: () => void;
};

type OpsWorkspaceProps = {
  activeView: "overview" | "simulation";
  setActiveView: (view: ActiveView) => void;
  phase: string;
  summaryTime: string;
  environmentLabel: string;
  summaryText: string;
  mapFacts: ObservedFact[];
  overviewTracks: OverviewTrack[];
  selectedOverviewTrack: OverviewTrack | undefined;
  setSelectedOverviewTrackId: (id: string) => void;
  reportWindowItems: MessageTrafficItem[];
  showOrders: ShowOrderItem[];
  topActions: { id: string; description: string; confidence?: string }[];
  candidates: CoaCandidate[];
  selectedCoaId: string | undefined;
  onSelectCoa: (id: string) => void;
  onRunCoaEvaluation: () => void;
  coaRunning: boolean;
  simClockPaused: boolean;
  simClockScale: number;
  simClockLabel: string;
  simElapsedMs: number;
  onSetSimClockScale: (scale: number) => void;
  onToggleSimPause: () => void;
  onRestartSim: () => void;
  commanderIntent?: string;
  validatedDecisionPoints: DecisionPoint[];
  displayedPlan: ReturnType<typeof useDisplayedPlan>;
  coaPipelineStatus: "idle" | "running" | "ready" | "error";
};

type TimelineFilter = "all" | "threats" | "sensors" | "decisions" | "system";

const EMPTY_HIGHLIGHT_FACT_IDS: string[] = [];

function formatStatus(track: OverviewTrack): "THREAT" | "FRIENDLY" | "UNKNOWN" | "STALE" {
  if (track.stalenessState === "stale") return "STALE";
  if (track.side === "hostile") return "THREAT";
  if (track.side === "friendly") return "FRIENDLY";
  return "UNKNOWN";
}

function MissionSummaryContent({
  phase,
  summaryTime,
  environmentLabel,
}: {
  phase: string;
  summaryTime: string;
  environmentLabel: string;
}) {
  return (
    <div className={styles.summaryGrid}>
      <span>Objective</span>
      <strong>Maintain Strait Stability</strong>
      <span>Area</span>
      <strong>{environmentLabel}</strong>
      <span>Primary Concern</span>
      <strong>Multi-domain sensor degradation and strike risk</strong>
      <span>Phase</span>
      <strong>{phase}</strong>
      <span>Time in Phase</span>
      <strong>{summaryTime}</strong>
    </div>
  );
}

function MissionMenu(props: Pick<OpsHeaderProps, "phase" | "summaryTime" | "environmentLabel">) {
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
    <div className={styles.missionMenuWrap} ref={menuRef}>
      <button
        type="button"
        className={open ? styles.headerButtonActive : styles.headerButton}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Mission
      </button>
      {open && (
        <div className={styles.missionPopover} role="dialog" aria-label="Mission summary">
          <h3 className={styles.dashboardTitle}>Mission Summary</h3>
          <MissionSummaryContent
            phase={props.phase}
            summaryTime={props.summaryTime}
            environmentLabel={props.environmentLabel}
          />
        </div>
      )}
    </div>
  );
}

function CommandHeader(props: OpsHeaderProps) {
  const opsWindows = useOpsWindowsOptional();

  return (
    <header className={styles.commandHeader}>
      <div className={styles.commandHeaderRow}>
        <div className={styles.brandBlock}>
          <div className={styles.brandTitle}>CODA2</div>
          <div className={styles.brandSub}>COA Pipeline</div>
        </div>
        <div className={styles.headerStat}>
          <span>Scenario</span>
          <strong>Broken Signal</strong>
        </div>
        <div className={styles.headerStat}>
          <span>Simulation</span>
          <strong>{props.simClockPaused ? "PAUSED" : "RUNNING"}</strong>
        </div>
        <div className={styles.headerStat}>
          <span>Sim Time</span>
          <strong>{props.simNowIso.slice(11, 19)}</strong>
        </div>
        <div className={styles.headerStat}>
          <span>Threat Level</span>
          <strong>{props.threatLevel}</strong>
        </div>
        <div className={styles.headerStat}>
          <span>Confidence</span>
          <strong>{props.confidenceLevel}</strong>
        </div>
        <div className={styles.headerControls}>
          {opsWindows && (
            <WindowsMenu
              windows={opsWindows.windows}
              onShowWindow={opsWindows.showWindow}
              onHideWindow={opsWindows.hideWindow}
              onToggleMinimized={opsWindows.toggleMinimized}
            />
          )}
          <MissionMenu
            phase={props.phase}
            summaryTime={props.summaryTime}
            environmentLabel={props.environmentLabel}
          />
          <button type="button" className={styles.headerButton} onClick={props.onToggleClockPaused}>
            {props.simClockPaused ? "Resume" : "Pause"}
          </button>
          <button type="button" className={styles.headerButton} onClick={props.onRestartSim}>
            Restart
          </button>
          <button type="button" className={styles.headerButton} onClick={props.onExportTrace}>
            Export Trace
          </button>
        </div>
      </div>
      <NavigationTabs activeView={props.activeView} setActiveView={props.setActiveView} />
    </header>
  );
}

function NavigationTabs({
  activeView,
  setActiveView,
}: {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
}) {
  const tabs: Array<{ id: ActiveView; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "simulation", label: "Simulation" },
    { id: "coas", label: "COA" },
    { id: "reports", label: "Reports" },
    { id: "trace", label: "Decision Trace" },
  ];
  return (
    <nav className={styles.commandNav}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={activeView === tab.id ? styles.commandNavActive : styles.commandNavItem}
          onClick={() => setActiveView(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function ActiveContactsPanel({
  tracks,
  selectedTrack,
  selectedId,
  onSelect,
}: {
  tracks: OverviewTrack[];
  selectedTrack: OverviewTrack | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const listTracks =
    selectedTrack && !tracks.some((track) => track.id === selectedTrack.id)
      ? [selectedTrack, ...tracks]
      : tracks;

  return (
    <section className={`${styles.dashboardCard} ${styles.timelineCard}`}>
      <h3 className={styles.dashboardTitle}>
        Active Contacts
        {tracks.length > 0 && (
          <span className={styles.contactCount}> {tracks.length}</span>
        )}
      </h3>
      <div className={styles.contactsList}>
        {listTracks.length === 0 && (
          <p className={styles.panelHint}>
            No contacts in sensor range. Run the pipeline, <strong>Restart</strong>, or advance sim time.
          </p>
        )}
        {listTracks.map((track) => {
          const status = formatStatus(track);
          return (
            <button
              key={track.id}
              type="button"
              className={selectedId === track.id ? styles.contactRowActive : styles.contactRow}
              onClick={() => onSelect(track.id)}
            >
              <div className={styles.contactTopLine}>
                <strong>{track.callsign}</strong>
                <span
                  className={`${styles.contactBadge} ${
                    status === "THREAT"
                      ? styles.badgeThreat
                      : status === "FRIENDLY"
                        ? styles.badgeFriendly
                        : status === "STALE"
                          ? styles.badgeStale
                          : styles.badgeUnknown
                  }`}
                >
                  {status}
                </span>
              </div>
              <div className={styles.contactMeta}>
                <span>{track.classification.toUpperCase()}</span>
                <span>Alt {Math.max(120, track.uncertaintyMeters)}m</span>
                <span>
                  Spd{" "}
                  {track.moving && track.speedKts
                    ? `${Math.round(track.speedKts)} kts`
                    : `${30 + Math.round(track.confidence * 40)} kts`}
                </span>
                {track.moving && track.headingDeg !== undefined && (
                  <span>Hdg {track.headingDeg}°</span>
                )}
                <span>Conf {Math.round(track.confidence * 100)}%</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function formatTrackPosition(track: OverviewTrack): string {
  if (!track.coordinates) return "—";
  return formatCoordLabel([track.coordinates.lng, track.coordinates.lat]);
}

function SelectedTrackPanel({ track }: { track: OverviewTrack }) {
  const status = formatStatus(track);
  return (
    <section className={styles.dashboardCard}>
      <h3 className={styles.dashboardTitle}>Selected Track</h3>
      <div className={styles.contactTopLine}>
        <strong className={styles.trackDetailCallsign}>{track.callsign}</strong>
        <span
          className={`${styles.contactBadge} ${
            status === "THREAT"
              ? styles.badgeThreat
              : status === "FRIENDLY"
                ? styles.badgeFriendly
                : status === "STALE"
                  ? styles.badgeStale
                  : styles.badgeUnknown
          }`}
        >
          {status}
        </span>
      </div>
      <div className={styles.trackDetailGrid}>
        <span>Status</span><strong>{track.side.toUpperCase()}</strong>
        <span>Type</span><strong>{track.classification.toUpperCase()}</strong>
        <span>Altitude</span><strong>{Math.max(120, track.uncertaintyMeters)} m</strong>
        <span>Speed</span>
        <strong>
          {track.moving && track.speedKts
            ? `${Math.round(track.speedKts)} kts`
            : `${30 + Math.round(track.confidence * 40)} kts`}
        </strong>
        <span>Heading</span>
        <strong>{track.moving && track.headingDeg !== undefined ? `${track.headingDeg}°` : "—"}</strong>
        <span>Position</span>
        <strong className={styles.trackCoord}>{formatTrackPosition(track)}</strong>
        <span>Confidence</span><strong>{Math.round(track.confidence * 100)}%</strong>
        <span>Detected by</span><strong>{track.detectedBy || "—"}</strong>
        <span>Last update</span><strong>{track.lastUpdate}</strong>
      </div>
      <p className={styles.trackDetailSummary}>{track.summary}</p>
    </section>
  );
}

type MapLayerMode = "main" | "sensors" | "threats" | "zones";

type MissionTimePanelProps = {
  simClockPaused: boolean;
  simClockLabel: string;
  simClockScale: number;
  simElapsedMs: number;
  onSetSimClockScale: (scale: number) => void;
};

function MissionTimePanel({
  simClockPaused,
  simClockLabel,
  simClockScale,
  simElapsedMs,
  onSetSimClockScale,
}: MissionTimePanelProps) {
  return (
    <div className={styles.opsSideSection} aria-label="Mission time controls">
      <h4 className={styles.dashboardSubtitle}>Mission Time</h4>
      <div className={styles.metricRow}>
        <span>Clock state</span>
        <strong>{simClockPaused ? "Paused" : "Running"}</strong>
      </div>
      <div className={styles.metricRow}>
        <span>Sim elapsed</span>
        <strong>{formatSimElapsed(simElapsedMs)}</strong>
      </div>
      <div className={styles.metricRow}>
        <span>Compression</span>
        <strong>{simClockLabel}</strong>
      </div>
      <div className={`${styles.timeScaleRow} ${styles.timeScaleRowWrap}`}>
        {SIM_TIME_SCALES.map((scale) => (
          <button
            key={scale}
            type="button"
            className={simClockScale === scale ? styles.timelineFilterActive : styles.timelineFilter}
            onClick={() => onSetSimClockScale(scale)}
          >
            x{scale}
          </button>
        ))}
      </div>
    </div>
  );
}

function OperationalMapPanel({
  mapFacts,
  tracks,
  selectedTrack,
  focusFactId,
  focusNonce,
  highlightedFactIds,
  simElapsedMs,
  onFactIconClick,
  onPinnedCoordUpdate,
}: {
  mapFacts: ObservedFact[];
  tracks: OverviewTrack[];
  selectedTrack: OverviewTrack | undefined;
  focusFactId?: string;
  focusNonce?: number;
  highlightedFactIds?: string[];
  simElapsedMs: number;
  onFactIconClick: (factId: string) => void;
  onPinnedCoordUpdate?: (factId: string, coord: [number, number]) => void;
}) {
  const [layerMode, setLayerMode] = useState<MapLayerMode>("main");
  return (
    <section className={`${styles.dashboardCard} ${styles.mapCardStretch} ${styles.mapCardFill}`}>
      <div className={styles.panelHeaderRow}>
        <h3 className={styles.dashboardTitle}>Operational Map</h3>
        <div className={styles.mapPanelControls}>
          <select
            className={styles.layersSelect}
            value={layerMode}
            onChange={(e) => setLayerMode(e.target.value as MapLayerMode)}
          >
            <option value="main">Contacts</option>
            <option value="sensors">Sensor Coverage</option>
            <option value="zones">Mission Zones</option>
            <option value="threats">Threat Tracks</option>
          </select>
        </div>
      </div>
      <div className={styles.mapPanel}>
        <div className={styles.mapLibreHost}>
          <SituationalMap
            facts={mapFacts}
            tracks={tracks}
            selectedTrackId={selectedTrack?.id}
            focusFactId={focusFactId}
            focusNonce={focusNonce}
            highlightedFactIds={highlightedFactIds}
            simElapsedMs={simElapsedMs}
            onFactIconClick={onFactIconClick}
            onPinnedCoordUpdate={onPinnedCoordUpdate}
            layerMode={layerMode}
          />
        </div>
      </div>
    </section>
  );
}

function RecommendedActionPanel({
  recommendation,
  selectedCoa,
}: {
  recommendation: string;
  selectedCoa: CoaCandidate | undefined;
}) {
  const confidence = selectedCoa?.effects
    ? Math.round(selectedCoa.effects.confidence * 100)
    : selectedCoa?.scores
      ? Math.round(selectedCoa.scores.overall * 100)
      : 78;
  const risk = selectedCoa?.scores
    ? selectedCoa.scores.risk > 0.65
      ? "HIGH"
      : selectedCoa.scores.risk > 0.4
        ? "MEDIUM"
        : "LOW"
    : "MEDIUM";
  const riskColor =
    risk === "HIGH" ? styles.warnTextHigh : risk === "MEDIUM" ? styles.warnText : styles.warnTextLow;
  const explanation = selectedCoa?.effects?.explanation ?? recommendation;

  return (
    <section className={styles.dashboardCard}>
      <h3 className={styles.dashboardTitle}>
        {selectedCoa ? selectedCoa.label : "Recommended Action"}
      </h3>
      <p className={styles.recommendationText}>{explanation}</p>
      <div className={styles.metricRow}>
        <span>Confidence</span>
        <strong>{confidence}%</strong>
      </div>
      <div className={styles.confidenceBar}>
        <span style={{ width: `${confidence}%` }} />
      </div>
      <div className={styles.metricRow}>
        <span>Risk</span>
        <strong className={riskColor}>{risk}</strong>
      </div>
      {selectedCoa?.effects && (
        <div className={styles.metricRow}>
          <span>Time to effect</span>
          <strong>{Math.round(selectedCoa.effects.timeToEffect / 60)} min</strong>
        </div>
      )}
      <CyberEffectsBadge cyberEffects={selectedCoa?.effects?.cyberEffects} />
      {selectedCoa?.effects?.risks && selectedCoa.effects.risks.length > 0 && (
        <ul className={styles.constraintsList} style={{ marginTop: 8 }}>
          {selectedCoa.effects.risks.slice(0, 2).map((r) => (
            <li key={r} className={styles.warnText}>{r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STUB_COAS = [
  { id: "monitor", label: "Monitor", note: "Maintain current posture", score: null },
  { id: "retask-isr", label: "Re-task ISR", note: "Increase surveillance coverage", score: null },
  { id: "escalate", label: "Escalate", note: "Increase defensive posture", score: null },
  { id: "interdict", label: "Interdict", note: "Engage to neutralize threat", score: null },
];

function coaStatusBadge(coa: CoaCandidate): string {
  if (coa.status === "unsat") return "UNSAT";
  if (coa.status === "insufficient_evidence") return "INSUFF.";
  if (coa.status === "error") return "ERROR";
  return coa.effects ? `${Math.round(coa.scores.overall * 100)}%` : "READY";
}

function COAList({
  candidates,
  selectedCoaId,
  onSelectCoa,
}: {
  candidates: CoaCandidate[];
  selectedCoaId: string | undefined;
  onSelectCoa: (id: string) => void;
}) {
  const hasReal = candidates.length > 0;
  return (
    <section className={styles.dashboardCard}>
      <h3 className={styles.dashboardTitle}>
        Available COAs
        {hasReal && (
          <span className={styles.coaCount}> {candidates.length}</span>
        )}
      </h3>
      <div className={styles.coaList}>
        {hasReal
          ? candidates.map((coa) => (
              <button
                key={coa.id}
                type="button"
                className={selectedCoaId === coa.id ? styles.coaRowActive : styles.coaRow}
                onClick={() => onSelectCoa(coa.id)}
              >
                <div className={styles.coaTopLine}>
                  <strong>{coa.label}</strong>
                  <span className={coa.status === "sat" ? styles.coaScoreBadge : styles.coaBadgeUnsat}>
                    {coaStatusBadge(coa)}
                  </span>
                </div>
                {coa.effects && (
                  <>
                    <span className={styles.coaNote}>
                      Impact {Math.round(coa.effects.expectedImpact * 100)}% · Risk{" "}
                      {Math.round(coa.scores.risk * 100)}%
                    </span>
                    <CyberEffectsBadge
                      cyberEffects={coa.effects.cyberEffects}
                      compact
                    />
                  </>
                )}
                {!coa.effects && (
                  <span className={styles.coaNote}>
                    {coa.selectedActions.length} action{coa.selectedActions.length !== 1 ? "s" : ""}
                  </span>
                )}
              </button>
            ))
          : STUB_COAS.map((coa) => (
              <button
                key={coa.id}
                type="button"
                className={selectedCoaId === coa.id ? styles.coaRowActive : styles.coaRow}
                onClick={() => onSelectCoa(coa.id)}
              >
                <div className={styles.coaTopLine}>
                  <strong>{coa.label}</strong>
                </div>
                <span className={styles.coaNote}>{coa.note}</span>
              </button>
            ))}
      </div>
    </section>
  );
}

function ConstraintsCard() {
  const items = [
    "Limit asset hits ≤ 5",
    "Monitor at least 12 threats",
    "Preserve friendly corridor",
  ];
  return (
    <section className={styles.dashboardCard}>
      <h3 className={styles.dashboardTitle}>Constraints</h3>
      <ul className={styles.constraintsList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function resolveOrderFactId(order: ShowOrderItem): string | undefined {
  if (order.factId) return order.factId;
  if (order.id.startsWith("order-track-")) return order.id.slice("order-track-".length);
  return undefined;
}

function ShowOrdersBody({
  orders,
  selectedOrderId,
  onSelectOrder,
}: {
  orders: ShowOrderItem[];
  selectedOrderId?: string;
  onSelectOrder: (order: ShowOrderItem, factId: string) => void;
}) {
  return (
    <div className={styles.actionsList}>
      {orders.length === 0 && (
        <div className={styles.orderRow}>
          <span className={styles.orderLampHold} />
          <span>No orders — run COA evaluation or select a track.</span>
        </div>
      )}
      {orders.map((order) => {
        const factId = resolveOrderFactId(order);
        const lamp = (
          <span
            className={
              order.status === "active"
                ? styles.orderLampActive
                : order.status === "queued"
                  ? styles.orderLampQueued
                  : styles.orderLampHold
            }
          />
        );
        const body = (
          <>
            <div className={styles.orderBody}>
              <strong>{order.status.toUpperCase()}</strong>
              <span>{order.order}</span>
            </div>
            <span className={styles.orderEta}>{order.eta}</span>
          </>
        );

        if (!factId) {
          return (
            <div key={order.id} className={styles.orderRow}>
              {lamp}
              {body}
            </div>
          );
        }

        return (
          <button
            key={order.id}
            type="button"
            className={
              selectedOrderId === order.id
                ? `${styles.orderRow} ${styles.orderRowButton} ${styles.orderRowActive}`
                : `${styles.orderRow} ${styles.orderRowButton}`
            }
            onClick={() => onSelectOrder(order, factId)}
            title="Show on map"
          >
            {lamp}
            {body}
          </button>
        );
      })}
    </div>
  );
}

function CoaPlanningBody({
  recommendation,
  selectedCoa,
  candidates,
  selectedCoaId,
  onSelectCoa,
  onRunCoaEvaluation,
  coaRunning,
  commanderIntent,
  validatedDecisionPoints,
  onOpenCommanderMatrix,
}: {
  recommendation: string;
  selectedCoa: CoaCandidate | undefined;
  candidates: CoaCandidate[];
  selectedCoaId: string | undefined;
  onSelectCoa: (id: string) => void;
  onRunCoaEvaluation: () => void;
  coaRunning: boolean;
  commanderIntent?: string;
  validatedDecisionPoints: DecisionPoint[];
  onOpenCommanderMatrix: () => void;
}) {
  const evidenceConflicts = useEvidenceConflicts();
  const rankingSensitivity = useRankingSensitivity();

  return (
    <div className={styles.coaWindowStack}>
      <RecommendedActionPanel recommendation={recommendation} selectedCoa={selectedCoa} />
      <COAList
        candidates={candidates}
        selectedCoaId={selectedCoaId}
        onSelectCoa={onSelectCoa}
      />
      <EvidenceConflictsPanel conflicts={evidenceConflicts} />
      <ConstraintTracePanel candidate={selectedCoa} />
      <RankingSensitivityPanel sensitivity={rankingSensitivity} />
      <section className={styles.dashboardCard}>
        <div className={styles.panelHeaderRow}>
          <h3 className={styles.dashboardTitle}>Commander&apos;s Matrix</h3>
          <button
            type="button"
            className={styles.headerButton}
            onClick={onOpenCommanderMatrix}
          >
            Pop out
          </button>
        </div>
        <CommanderMatrix
          candidates={candidates}
          selectedCoaId={selectedCoaId}
          onSelectCoa={onSelectCoa}
          commanderIntent={commanderIntent}
          decisionPoints={validatedDecisionPoints}
          evidenceConflicts={evidenceConflicts}
          rankingSensitivity={rankingSensitivity}
          compact
          showAuditPanels={false}
        />
      </section>
      <ConstraintsCard />
      <button
        className={styles.primaryAction}
        type="button"
        onClick={onRunCoaEvaluation}
        disabled={coaRunning}
      >
        {coaRunning ? "Running COA..." : "Run COA Evaluation"}
      </button>
    </div>
  );
}

function resolveTimelineFactId(item: MessageTrafficItem, tracks: OverviewTrack[]): string | undefined {
  if (item.id.startsWith("fact-")) return item.id.slice("fact-".length);
  for (const track of tracks) {
    if (item.id.includes(`lifecycle-${track.id}-`)) return track.id;
    if (item.text.includes(track.callsign)) return track.id;
  }
  return undefined;
}

function EventTimeline({
  items,
  tracks,
  onFocusFact,
  onEventNavigate,
  highlightFactId,
  embedded = false,
}: {
  items: MessageTrafficItem[];
  tracks: OverviewTrack[];
  onFocusFact: (factId: string) => void;
  onEventNavigate: (item: MessageTrafficItem, factId?: string) => void;
  highlightFactId?: string;
  embedded?: boolean;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const filtered = items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "threats") return item.severity === "alert";
    if (filter === "sensors") return item.kind === "track";
    if (filter === "decisions") return item.kind === "ops" || item.kind === "validation";
    return item.kind === "validation";
  });

  return (
    <section className={embedded ? styles.timelineEmbed : styles.dashboardCard}>
      <div className={styles.panelHeaderRow}>
        {!embedded && <h3 className={styles.dashboardTitle}>Event Timeline</h3>}
        <div className={styles.timelineFilters}>
          {(["all", "threats", "sensors", "decisions", "system"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={filter === tab ? styles.timelineFilterActive : styles.timelineFilter}
              onClick={() => setFilter(tab)}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.timelineRows}>
        {filtered.slice(0, 8).map((item) => {
          const factId = resolveTimelineFactId(item, tracks);
          return (
          <button
            key={item.id}
            type="button"
            className={`${styles.timelineRow} ${styles.timelineRowButton} ${
              factId && highlightFactId === factId ? styles.timelineRowHighlighted : ""
            }`}
            onClick={() => {
              if (factId) onFocusFact(factId);
              onEventNavigate(item, factId);
            }}
          >
            <span>{item.time}</span>
            <span>{item.kind.toUpperCase()}</span>
            <span>{item.text}</span>
            <span>{item.id.replace(/^.*-/, "").toUpperCase()}</span>
          </button>
        )})}
      </div>
    </section>
  );
}

function SystemStatusSection({ running }: { running: boolean }) {
  return (
    <div className={styles.opsSideSection}>
      <h4 className={styles.dashboardSubtitle}>System Status</h4>
      <div className={styles.systemGrid}>
        <span>Sensors</span><strong>Operational</strong>
        <span>Data Link</span><strong>Stable</strong>
        <span>Comms</span><strong>Operational</strong>
        <span>Simulation</span><strong>{running ? "Running" : "Paused"}</strong>
      </div>
      <div className={styles.radarMini} aria-hidden />
    </div>
  );
}

export function OpsHeader(props: OpsHeaderProps) {
  return <CommandHeader {...props} />;
}

export function OpsWorkspace(props: OpsWorkspaceProps) {
  const selectedCoa = props.candidates.find((c) => c.id === props.selectedCoaId);
  const { windows, showWindow, hideWindow, setMinimized } = useOpsWindows();
  const [focusFactId, setFocusFactId] = useState<string | undefined>(undefined);
  const [focusNonce, setFocusNonce] = useState(0);
  const [timelineHighlightFactId, setTimelineHighlightFactId] = useState<string | undefined>(undefined);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | undefined>(undefined);
  const [selectedLogisticsChipId, setSelectedLogisticsChipId] = useState<string | undefined>();
  const [liveTrackCoord, setLiveTrackCoord] = useState<[number, number] | null>(null);
  const recommendation =
    props.topActions[0]?.description ??
    "Re-task ISR to verify mixed tracks and protect Taiwan Strait corridors.";

  const selectTrack = (factId: string) => {
    props.setSelectedOverviewTrackId(factId);
    setTimelineHighlightFactId(factId);
    setLiveTrackCoord(null);
  };

  useEffect(() => {
    setLiveTrackCoord(null);
  }, [props.selectedOverviewTrack?.id]);

  useEffect(() => {
    setSelectedLogisticsChipId(undefined);
  }, [props.selectedCoaId]);

  const displayedSelectedTrack = useMemo(() => {
    if (!props.selectedOverviewTrack) return undefined;
    if (!liveTrackCoord) return props.selectedOverviewTrack;
    return {
      ...props.selectedOverviewTrack,
      coordinates: { lat: liveTrackCoord[1], lng: liveTrackCoord[0] },
    };
  }, [props.selectedOverviewTrack, liveTrackCoord]);

  const focusTrackOnMap = (factId: string) => {
    selectTrack(factId);
    setFocusFactId(factId);
    setFocusNonce((n) => n + 1);
  };

  const highlightedFactIds = useMemo((): string[] => {
    if (props.displayedPlan.kind !== "populated" || !selectedLogisticsChipId) {
      return EMPTY_HIGHLIGHT_FACT_IDS;
    }
    const chip = props.displayedPlan.chips.find((c) => c.id === selectedLogisticsChipId);
    return chip?.linkedFactIds?.length ? [...chip.linkedFactIds] : EMPTY_HIGHLIGHT_FACT_IDS;
  }, [props.displayedPlan, selectedLogisticsChipId]);

  const handleLogisticsChipSelect = (chip: LogisticsChip) => {
    setSelectedLogisticsChipId(chip.id);
    const primaryFact = chip.linkedFactIds?.[0];
    if (primaryFact) {
      const linkedOrder = props.showOrders.find(
        (order) => order.factId === primaryFact || order.id === `order-log-${chip.id}`
      );
      if (linkedOrder) setHighlightedOrderId(linkedOrder.id);
      focusTrackOnMap(primaryFact);
    }
  };

  const navigateFromOrder = (order: ShowOrderItem, factId: string) => {
    setHighlightedOrderId(order.id);
    if (order.id.startsWith("order-log-")) {
      setSelectedLogisticsChipId(order.id.slice("order-log-".length));
    }
    if (factId) focusTrackOnMap(factId);
  };

  useEffect(() => {
    const trackId = props.selectedOverviewTrack?.id;
    if (!trackId) return;
    const linkedOrder = props.showOrders.find(
      (order) => resolveOrderFactId(order) === trackId
    );
    if (linkedOrder) setHighlightedOrderId(linkedOrder.id);
  }, [props.selectedOverviewTrack?.id, props.showOrders]);
  const navigateFromEvent = (item: MessageTrafficItem, factId?: string) => {
    if (factId) {
      setTimelineHighlightFactId(factId);
      showWindow("timeline");
      focusTrackOnMap(factId);
      return;
    }

    // Fallback tie-in: infer track by callsign mention in event text.
    const matchedTrack = props.overviewTracks.find((track) => item.text.includes(track.callsign));
    if (matchedTrack) {
      setTimelineHighlightFactId(matchedTrack.id);
      showWindow("timeline");
      focusTrackOnMap(matchedTrack.id);
    }
  };

  const leftPanel = (
    <>
      <ActiveContactsPanel
        tracks={props.overviewTracks}
        selectedTrack={displayedSelectedTrack}
        selectedId={props.selectedOverviewTrack?.id}
        onSelect={selectTrack}
      />
      {displayedSelectedTrack && <SelectedTrackPanel track={displayedSelectedTrack} />}
    </>
  );

  const logisticsEmptyContext = useMemo(
    () => ({
      pipelineStatus: props.coaPipelineStatus,
      selectedCoaLabel: selectedCoa?.label,
      selectedCoaStatus: selectedCoa?.status,
      satCount: props.candidates.filter((c) => c.status === "sat").length,
    }),
    [
      props.coaPipelineStatus,
      selectedCoa?.label,
      selectedCoa?.status,
      props.candidates,
    ]
  );

  const centerPanel = (
    <MapLogisticsStack
      selectedCoaLabel={selectedCoa?.label}
      displayedPlan={props.displayedPlan}
      selectedChipId={selectedLogisticsChipId}
      onChipSelect={handleLogisticsChipSelect}
      emptyContext={logisticsEmptyContext}
      map={
        <OperationalMapPanel
          mapFacts={props.mapFacts}
          tracks={props.overviewTracks}
          selectedTrack={props.selectedOverviewTrack}
          focusFactId={focusFactId}
          focusNonce={focusNonce}
          highlightedFactIds={highlightedFactIds}
          simElapsedMs={props.simElapsedMs}
          onFactIconClick={selectTrack}
          onPinnedCoordUpdate={(factId, coord) => {
            if (factId === props.selectedOverviewTrack?.id) {
              setLiveTrackCoord(coord);
            }
          }}
        />
      }
    />
  );

  const rightPanel = (
    <section className={`${styles.dashboardCard} ${styles.opsSidePanel}`}>
      <h3 className={styles.dashboardTitle}>Simulation</h3>
      <p className={styles.panelHint}>
        COA, orders, and timeline: <strong>Windows</strong> menu (header).
      </p>
      <MissionTimePanel
        simClockPaused={props.simClockPaused}
        simClockLabel={props.simClockLabel}
        simClockScale={props.simClockScale}
        simElapsedMs={props.simElapsedMs}
        onSetSimClockScale={props.onSetSimClockScale}
      />
      <div className={styles.secondaryActions}>
        <button type="button" className={styles.headerButton} onClick={props.onToggleSimPause}>
          Pause Sim
        </button>
        <button type="button" className={styles.headerButton} onClick={props.onRestartSim}>
          Restart Sim
        </button>
      </div>
      <SystemStatusSection running={!props.simClockPaused} />
    </section>
  );

  return (
    <>
      <ResizableLayout
        left={leftPanel}
        center={centerPanel}
        right={rightPanel}
        defaultLeft={300}
        defaultRight={280}
      />
      <ModelessWindow
        title="Event Timeline"
        open={windows.timeline.open}
        minimized={windows.timeline.minimized}
        onMinimizedChange={(minimized) => setMinimized("timeline", minimized)}
        onClose={() => hideWindow("timeline")}
        defaultPosition={{ x: 320, y: 120 }}
        defaultWidth={680}
        defaultHeight={360}
        minWidth={400}
        maxWidth={960}
        zIndex={70}
      >
        <EventTimeline
          items={props.reportWindowItems}
          tracks={props.overviewTracks}
          embedded
          onFocusFact={(factId) => {
            focusTrackOnMap(factId);
            setTimelineHighlightFactId(factId);
            showWindow("timeline");
          }}
          onEventNavigate={navigateFromEvent}
          highlightFactId={timelineHighlightFactId}
        />
      </ModelessWindow>
      <ModelessWindow
        title="Show Orders"
        open={windows.orders.open}
        minimized={windows.orders.minimized}
        onMinimizedChange={(minimized) => setMinimized("orders", minimized)}
        onClose={() => hideWindow("orders")}
        defaultPosition={{ x: 320, y: 460 }}
        defaultWidth={420}
        defaultHeight={280}
        zIndex={71}
      >
        <ShowOrdersBody
          orders={props.showOrders}
          selectedOrderId={highlightedOrderId}
          onSelectOrder={navigateFromOrder}
        />
      </ModelessWindow>
      <ModelessWindow
        title="COA Planning"
        open={windows.coa.open}
        minimized={windows.coa.minimized}
        onMinimizedChange={(minimized) => setMinimized("coa", minimized)}
        onClose={() => hideWindow("coa")}
        defaultPosition={{ x: 880, y: 120 }}
        defaultWidth={360}
        defaultHeight={480}
        minWidth={300}
        zIndex={72}
      >
        <CoaPlanningBody
          recommendation={recommendation}
          selectedCoa={selectedCoa}
          candidates={props.candidates}
          selectedCoaId={props.selectedCoaId}
          onSelectCoa={props.onSelectCoa}
          onRunCoaEvaluation={props.onRunCoaEvaluation}
          coaRunning={props.coaRunning}
          commanderIntent={props.commanderIntent}
          validatedDecisionPoints={props.validatedDecisionPoints}
          onOpenCommanderMatrix={() => showWindow("commanderMatrix")}
        />
      </ModelessWindow>
      <ModelessWindow
        title="Commander's Matrix"
        open={windows.commanderMatrix.open}
        minimized={windows.commanderMatrix.minimized}
        onMinimizedChange={(minimized) => setMinimized("commanderMatrix", minimized)}
        onClose={() => hideWindow("commanderMatrix")}
        defaultPosition={{ x: 520, y: 100 }}
        defaultWidth={720}
        defaultHeight={520}
        minWidth={480}
        zIndex={73}
      >
        <div className={styles.commanderMatrixWindow}>
          <CommanderMatrixPopout
            candidates={props.candidates}
            selectedCoaId={props.selectedCoaId}
            onSelectCoa={props.onSelectCoa}
            commanderIntent={props.commanderIntent}
            decisionPoints={props.validatedDecisionPoints}
          />
          <section className={styles.dashboardCard}>
            <h3 className={styles.dashboardTitle}>
              Logistics — {selectedCoa?.label ?? "no COA selected"}
            </h3>
            <div className={styles.logisticsMatrixHost}>
              <LogisticsMatrix plan={props.displayedPlan} allowDemo />
            </div>
          </section>
        </div>
      </ModelessWindow>
    </>
  );
}
