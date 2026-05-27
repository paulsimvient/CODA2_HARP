import { useEffect, useMemo, useRef, useState } from "react";
import { buildScenarioPacket } from "../../intel/scenarioPacket";
import { extractValidatedActions, validateGrounding } from "../../intel/grounding";
import { llmInterpreter } from "../../intel/interpreter";
import type {
  GroundingValidationResult,
  LLMInterpretation,
  ObservedFact,
} from "../../intel/types";
import { signalToObservedFact } from "../../sim/factNormalizer";
import {
  createAssetTelemetrySignals,
  createRadarSensors,
  createUavSensor,
  createWorldChangeSignalFactory,
  type RawSensorSignal,
} from "../../sim/sensors";
import { shouldEmitSignal } from "../../sim/signals";
import { type TrackFile, updateTracksFromSignals } from "../../sim/tracks";
import { buildWorldObjects } from "../../sim/world";
import styles from "./RealtimeProofGame.module.css";

type Asset = {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  kind: "port" | "radar" | "depot";
};

type Threat = {
  id: number;
  x: number;
  y: number;
  speed: number;
  targetAssetId: string;
  behavior: "ingress" | "jink" | "commit";
};

type UavState = {
  x: number;
  y: number;
  mode: "patrol" | "intercept" | "scan";
};

type ImpactBlast = {
  id: string;
  x: number;
  y: number;
  radius: number;
  lifeMs: number;
  kind: "intercept" | "asset-hit";
};

type SensorMode = "off" | "passive" | "active" | "intermittent";
type DoctrineProfile = "cautious" | "balanced" | "aggressive";
type OperationalOrder = "intercept" | "shadow" | "scan" | "hold-fire";

type DoctrineState = {
  profile: DoctrineProfile;
  evasiveProbability: number;
  commitRangeMeters: number;
};

type SensorRingModes = {
  mainBody: SensorMode;
  aawRing: SensorMode;
  aswRing: SensorMode;
  picketRing: SensorMode;
};

type DoctrinePreset = {
  key: "harass" | "saturation" | "probing" | "custom";
  label: string;
  doctrine: DoctrineState;
  spawnCadenceMultiplier: number;
  sensorSilenceCycleMs: number;
  sensorActiveWindowMs: number;
};

type ScenarioKey = "port-shield" | "night-convoy" | "silent-probing";

type ScenarioObjective = {
  id: string;
  label: string;
  metric: "interceptions" | "assetHits" | "integrity";
  comparator: "gte" | "lte";
  value: number;
};

type ScenarioDefinition = {
  key: ScenarioKey;
  title: string;
  theatre: string;
  startIso: string;
  durationHours: number;
  briefing: string;
  doctrinePreset: Exclude<DoctrinePreset["key"], "custom">;
  spawnMultiplier: number;
  assets: Asset[];
  objectives: ScenarioObjective[];
};

type ManualMenu = "File" | "Orders" | "Settings" | "Reports" | "Misc" | "Windows" | "Help";
type ManualCommand = {
  id: string;
  label: string;
  menu: ManualMenu;
  action: "navigate" | "execute";
  targetMenu?: ManualMenu;
};

type ScenarioEvent = {
  id: string;
  at: string;
  kind: RawSensorSignal["kind"] | "staff-note" | "track-lifecycle";
  detail: string;
  x?: number;
  y?: number;
  sensorId?: string;
  confidence?: number;
};

type StaffNote = {
  id: string;
  text: string;
  deliverAtSimMs: number;
  delivered: boolean;
};

type Snapshot = {
  id: string;
  at: string;
  elapsedMs: number;
  uavX: number;
  uavY: number;
  mode: UavState["mode"];
  activeThreats: number;
  assetIntegrity: number;
  interceptions: number;
  assetHits: number;
  recentFactIds: string[];
  validatorStatus: "passed" | "failed" | "not-run";
  nonce: string;
};

type OverviewTrackContext = {
  id: string;
  callsign: string;
  side: "unknown" | "hostile" | "friendly";
  classification: "unknown-air" | "uas" | "signal-source";
  confidence: number;
  stalenessState: "fresh" | "warm" | "stale";
};

type RealtimeProofGameProps = {
  overviewTrackContext?: OverviewTrackContext;
};

const FIELD_WIDTH = 820;
const FIELD_HEIGHT = 500;
const UAV_SIZE = 16;
const DEFAULT_TIME_SCALES = [1, 5, 15, 30, 60] as const;
const STEP_INTERVAL_MS = 5 * 60 * 1000;
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
const EVIDENCE_INTERVAL_MS = 5 * 60 * 1000;
const DAY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CUSTOM_DOCTRINE_STORAGE_KEY = "coda2.realtime.doctrine.custom.v1";
const DOCTRINE_PRESETS: Record<DoctrinePreset["key"], DoctrinePreset> = {
  harass: {
    key: "harass",
    label: "Harass",
    doctrine: { profile: "balanced", evasiveProbability: 0.6, commitRangeMeters: 120 },
    spawnCadenceMultiplier: 1.05,
    sensorSilenceCycleMs: 70_000,
    sensorActiveWindowMs: 50_000,
  },
  saturation: {
    key: "saturation",
    label: "Saturation Attack",
    doctrine: { profile: "aggressive", evasiveProbability: 0.35, commitRangeMeters: 190 },
    spawnCadenceMultiplier: 0.55,
    sensorSilenceCycleMs: 45_000,
    sensorActiveWindowMs: 42_000,
  },
  probing: {
    key: "probing",
    label: "Low-Signature Probing",
    doctrine: { profile: "cautious", evasiveProbability: 0.78, commitRangeMeters: 95 },
    spawnCadenceMultiplier: 1.45,
    sensorSilenceCycleMs: 95_000,
    sensorActiveWindowMs: 28_000,
  },
  custom: {
    key: "custom",
    label: "Custom",
    doctrine: { profile: "balanced", evasiveProbability: 0.55, commitRangeMeters: 130 },
    spawnCadenceMultiplier: 1,
    sensorSilenceCycleMs: 60_000,
    sensorActiveWindowMs: 45_000,
  },
};

const SCENARIOS: Record<ScenarioKey, ScenarioDefinition> = {
  "port-shield": {
    key: "port-shield",
    title: "Port Shield 24",
    theatre: "Port A Urban Littoral",
    startIso: "2026-05-24T00:00:00Z",
    durationHours: 24,
    briefing:
      "Defend primary port assets against sustained multi-wave UAS incursions while preserving logistics continuity.",
    doctrinePreset: "harass",
    spawnMultiplier: 1,
    assets: [
      { id: "asset-port", name: "Port A", x: 110, y: 410, hp: 100, maxHp: 100, kind: "port" },
      { id: "asset-radar", name: "Radar Node", x: 390, y: 365, hp: 100, maxHp: 100, kind: "radar" },
      { id: "asset-depot", name: "Supply Depot", x: 650, y: 395, hp: 100, maxHp: 100, kind: "depot" },
    ],
    objectives: [
      { id: "obj-1", label: "Intercept at least 12 threats", metric: "interceptions", comparator: "gte", value: 12 },
      { id: "obj-2", label: "Keep asset integrity >= 70%", metric: "integrity", comparator: "gte", value: 70 },
      { id: "obj-3", label: "Limit asset hits to <= 5", metric: "assetHits", comparator: "lte", value: 5 },
    ],
  },
  "night-convoy": {
    key: "night-convoy",
    title: "Night Convoy Shield",
    theatre: "Port A Southern Approach",
    startIso: "2026-05-24T18:00:00Z",
    durationHours: 12,
    briefing:
      "Protect high-value logistics flow through reduced-visibility conditions with constrained sensor confidence.",
    doctrinePreset: "saturation",
    spawnMultiplier: 0.85,
    assets: [
      { id: "asset-port", name: "Port A", x: 130, y: 405, hp: 100, maxHp: 100, kind: "port" },
      { id: "asset-radar", name: "Radar Node", x: 430, y: 345, hp: 100, maxHp: 100, kind: "radar" },
      { id: "asset-depot", name: "Convoy Depot", x: 690, y: 385, hp: 100, maxHp: 100, kind: "depot" },
    ],
    objectives: [
      { id: "obj-1", label: "Intercept at least 16 threats", metric: "interceptions", comparator: "gte", value: 16 },
      { id: "obj-2", label: "Keep asset integrity >= 60%", metric: "integrity", comparator: "gte", value: 60 },
      { id: "obj-3", label: "Limit asset hits to <= 8", metric: "assetHits", comparator: "lte", value: 8 },
    ],
  },
  "silent-probing": {
    key: "silent-probing",
    title: "Silent Probing",
    theatre: "Port A Signals Corridor",
    startIso: "2026-05-25T03:00:00Z",
    durationHours: 36,
    briefing:
      "Track low-signature probing flights and preserve attribution discipline while preventing cumulative degradation.",
    doctrinePreset: "probing",
    spawnMultiplier: 1.35,
    assets: [
      { id: "asset-port", name: "Port A", x: 120, y: 420, hp: 100, maxHp: 100, kind: "port" },
      { id: "asset-radar", name: "SIGINT Radar", x: 360, y: 340, hp: 100, maxHp: 100, kind: "radar" },
      { id: "asset-depot", name: "Signals Hub", x: 620, y: 380, hp: 100, maxHp: 100, kind: "depot" },
    ],
    objectives: [
      { id: "obj-1", label: "Intercept at least 10 threats", metric: "interceptions", comparator: "gte", value: 10 },
      { id: "obj-2", label: "Keep asset integrity >= 80%", metric: "integrity", comparator: "gte", value: 80 },
      { id: "obj-3", label: "Limit asset hits to <= 3", metric: "assetHits", comparator: "lte", value: 3 },
    ],
  },
};

export function RealtimeProofGame({ overviewTrackContext }: RealtimeProofGameProps) {
  const [selectedScenarioKey, setSelectedScenarioKey] = useState<ScenarioKey>("port-shield");
  const [uav, setUav] = useState<UavState>({ x: FIELD_WIDTH * 0.5, y: FIELD_HEIGHT * 0.28, mode: "patrol" });
  const [assets, setAssets] = useState<Asset[]>(cloneAssets(SCENARIOS["port-shield"].assets));
  const [threats, setThreats] = useState<Threat[]>([]);
  const [blasts, setBlasts] = useState<ImpactBlast[]>([]);
  const [events, setEvents] = useState<ScenarioEvent[]>([]);
  const [tracks, setTracks] = useState<TrackFile[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [timeScale, setTimeScale] = useState<(typeof DEFAULT_TIME_SCALES)[number]>(1);
  const [showTruth, setShowTruth] = useState(false);
  const [showSensors, setShowSensors] = useState(true);
  const [uavSensorMode, setUavSensorMode] = useState<SensorMode>("active");
  const [radarSensorMode, setRadarSensorMode] = useState<SensorMode>("active");
  const [telemetryMode, setTelemetryMode] = useState<SensorMode>("passive");
  const [activeOrder, setActiveOrder] = useState<OperationalOrder>("intercept");
  const [ringModes, setRingModes] = useState<SensorRingModes>({
    mainBody: "active",
    aawRing: "intermittent",
    aswRing: "passive",
    picketRing: "off",
  });
  const [doctrine, setDoctrine] = useState<DoctrineState>({
    profile: "balanced",
    evasiveProbability: 0.55,
    commitRangeMeters: 130,
  });
  const [selectedDoctrinePresetKey, setSelectedDoctrinePresetKey] = useState<
    DoctrinePreset["key"]
  >("harass");
  const [customDoctrinePreset, setCustomDoctrinePreset] = useState<DoctrinePreset | null>(
    null
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [interceptions, setInterceptions] = useState(0);
  const [assetHits, setAssetHits] = useState(0);
  const [observedFacts, setObservedFacts] = useState<ObservedFact[]>([]);
  const [interpretation, setInterpretation] = useState<LLMInterpretation | undefined>();
  const [grounding, setGrounding] = useState<GroundingValidationResult | undefined>();
  const [intelStatus, setIntelStatus] = useState<"idle" | "running" | "ready" | "error">(
    "idle"
  );
  const [intelError, setIntelError] = useState<string | undefined>();
  const [staffNoteText, setStaffNoteText] = useState("");
  const [staffNoteDelayMin, setStaffNoteDelayMin] = useState(5);
  const [staffNotes, setStaffNotes] = useState<StaffNote[]>([]);
  const [activeManualMenu, setActiveManualMenu] = useState<ManualMenu>("Reports");

  const uavRef = useRef<UavState>(uav);
  const assetsRef = useRef<Asset[]>(assets);
  const threatsRef = useRef<Threat[]>(threats);
  const blastsRef = useRef<ImpactBlast[]>([]);
  const eventsRef = useRef<ScenarioEvent[]>([]);
  const tracksRef = useRef<TrackFile[]>([]);
  const interceptionsRef = useRef(0);
  const assetHitsRef = useRef(0);
  const elapsedRef = useRef(0);
  const factsRef = useRef<ObservedFact[]>([]);
  const groundingRef = useRef<GroundingValidationResult | undefined>(undefined);
  const factCounterRef = useRef(0);
  const simStartEpochRef = useRef(Date.now());
  const nextSpawnAtSimMsRef = useRef(0);
  const nextSnapshotAtSimMsRef = useRef(SNAPSHOT_INTERVAL_MS);
  const nextEvidenceAtSimMsRef = useRef(EVIDENCE_INTERVAL_MS);
  const queuedStepMsRef = useRef(0);
  const hudAccRef = useRef(0);
  const threatIdRef = useRef(0);
  const scanAccRef = useRef(0);
  const evidenceRunTokenRef = useRef(0);
  const factsRevisionRef = useRef(0);
  const lastEvidenceRevisionRef = useRef(0);
  const previousAssetsRef = useRef<Asset[]>(cloneAssets(SCENARIOS["port-shield"].assets));
  const recentSignalKeysRef = useRef<Map<string, number>>(new Map());
  const staffNotesRef = useRef<StaffNote[]>([]);
  const initialMenuSyncRef = useRef(false);
  const filePanelRef = useRef<HTMLDivElement | null>(null);
  const ordersPanelRef = useRef<HTMLDivElement | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const reportsPanelRef = useRef<HTMLDivElement | null>(null);
  const miscPanelRef = useRef<HTMLDivElement | null>(null);
  const windowsPanelRef = useRef<HTMLDivElement | null>(null);
  const helpPanelRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);

  const activeScenario = SCENARIOS[selectedScenarioKey];
  const activeDoctrinePreset =
    selectedDoctrinePresetKey === "custom" && customDoctrinePreset
      ? customDoctrinePreset
      : DOCTRINE_PRESETS[selectedDoctrinePresetKey];
  const manualCommands = buildManualCommands(activeManualMenu);
  const gameStatus = useMemo(() => (running ? "running" : "idle"), [running]);

  useEffect(() => {
    uavRef.current = uav;
  }, [uav]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    threatsRef.current = threats;
  }, [threats]);

  useEffect(() => {
    staffNotesRef.current = staffNotes;
  }, [staffNotes]);

  useEffect(() => {
    startScenario(selectedScenarioKey);
    try {
      const raw = localStorage.getItem(CUSTOM_DOCTRINE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DoctrinePreset;
        if (parsed?.key === "custom") {
          setCustomDoctrinePreset(parsed);
        }
      }
    } catch {
      // no-op: localStorage may be unavailable
    }
    return () => {
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!initialMenuSyncRef.current) {
      initialMenuSyncRef.current = true;
      return;
    }
    scrollToManualMenu(activeManualMenu);
  }, [activeManualMenu]);

  function scrollToManualMenu(menu: ManualMenu) {
    const menuPanel: Record<ManualMenu, HTMLDivElement | null> = {
      File: filePanelRef.current,
      Orders: ordersPanelRef.current,
      Settings: settingsPanelRef.current,
      Reports: reportsPanelRef.current,
      Misc: miscPanelRef.current,
      Windows: windowsPanelRef.current,
      Help: helpPanelRef.current,
    };
    const target = menuPanel[menu];
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function runManualCommand(command: ManualCommand) {
    if (command.action === "navigate" && command.targetMenu) {
      setActiveManualMenu(command.targetMenu);
      scrollToManualMenu(command.targetMenu);
      return;
    }
    switch (command.id) {
      case "file-load-scenario":
        startScenario(selectedScenarioKey);
        break;
      case "file-restart":
        startScenario();
        break;
      case "file-save-snapshot":
        captureSnapshot();
        break;
      case "orders-attack":
        setActiveOrder("intercept");
        setActiveManualMenu("Orders");
        scrollToManualMenu("Orders");
        break;
      case "settings-cycle-time": {
        const idx = DEFAULT_TIME_SCALES.findIndex((scale) => scale === timeScale);
        const next = DEFAULT_TIME_SCALES[(idx + 1) % DEFAULT_TIME_SCALES.length] ?? 1;
        setTimeScale(next);
        setActiveManualMenu("Settings");
        scrollToManualMenu("Settings");
        break;
      }
      case "settings-toggle-sensors":
        setShowSensors((prev) => !prev);
        break;
      case "settings-pause":
        setPaused((prev) => !prev);
        break;
      case "misc-snapshot":
        captureSnapshot();
        break;
      case "misc-truth-toggle":
        setShowTruth((prev) => !prev);
        break;
      default:
        break;
    }
  }

  useEffect(() => {
    if (!running) return;

    let last = performance.now();

    const loop = (now: number) => {
      const wallDt = now - last;
      last = now;
      const steppedMs = queuedStepMsRef.current;
      queuedStepMsRef.current = 0;
      const dt = paused ? steppedMs : wallDt * timeScale;
      elapsedRef.current += dt;
      hudAccRef.current += wallDt;
      scanAccRef.current += dt;
      const simNowEpochMs = simStartEpochRef.current + elapsedRef.current;
      processDueStaffNotes(simNowEpochMs);

      while (elapsedRef.current >= nextSpawnAtSimMsRef.current) {
        spawnThreat();
        nextSpawnAtSimMsRef.current = scheduleNextSpawnSimMs(
          nextSpawnAtSimMsRef.current,
          activeDoctrinePreset.spawnCadenceMultiplier * activeScenario.spawnMultiplier
        );
      }

      const { x: nextUavX, y: nextUavY, mode } = computeUavMotion(
        uavRef.current,
        threatsRef.current,
        dt,
        activeOrder
      );
      uavRef.current = { x: nextUavX, y: nextUavY, mode };

      const nowIso = new Date(simNowEpochMs).toISOString();
      const pendingSignals: RawSensorSignal[] = [];
      const emitWorldChangeSignal = createWorldChangeSignalFactory(nowIso);
      let nextThreats: Threat[] = [];
      for (const t of threatsRef.current) {
        const target = assetsRef.current.find((a) => a.id === t.targetAssetId && a.hp > 0);
        if (!target) continue;
        const movement = computeThreatMovement(
          t,
          target,
          { x: nextUavX, y: nextUavY },
          elapsedRef.current,
          doctrine
        );
        const moved: Threat = {
          ...t,
          behavior: movement.behavior,
          x: t.x + movement.dir.x * movement.speed * dt,
          y: t.y + movement.dir.y * movement.speed * dt,
        };

        const uavDist = distance(moved.x, moved.y, nextUavX, nextUavY);
        if (uavDist < 34 && activeOrder !== "hold-fire") {
          interceptionsRef.current += 1;
          addBlast("intercept", moved.x, moved.y, 24);
          pendingSignals.push(
            emitWorldChangeSignal({
              sensorId: "fusion-intercept",
              sensorType: "fusion",
              kind: "intercept-detected",
              confidence: 0.97,
              severityHint: "high",
              objectId: `threat-${moved.id}`,
              objectKind: "hostile-drone",
              x: moved.x,
              y: moved.y,
              message: `Intercept event: hostile drone neutralized near ${target.name}`,
              metadata: { targetAssetId: target.id, targetAssetName: target.name },
            })
          );
          continue;
        }

        const assetDist = distance(moved.x, moved.y, target.x, target.y);
        if (assetDist < 20) {
          assetHitsRef.current += 1;
          damageAsset(target.id, 12);
          addBlast("asset-hit", target.x, target.y, 30);
          pendingSignals.push(
            emitWorldChangeSignal({
              sensorId: "fusion-impact",
              sensorType: "fusion",
              kind: "impact-detected",
              confidence: 0.95,
              severityHint: "critical",
              objectId: target.id,
              objectKind: "asset",
              x: target.x,
              y: target.y,
              message: `Impact event: hostile drone hit ${target.name}`,
              metadata: { assetId: target.id, assetName: target.name, damage: 12 },
            })
          );
          continue;
        }

        nextThreats.push(moved);
      }
      threatsRef.current = nextThreats;
      const worldObjects = buildWorldObjects({
        uav: uavRef.current,
        assets: assetsRef.current,
        threats: threatsRef.current,
      });
      const doctrineSensorWindowOpen = isDoctrineSensorWindowOpen(
        elapsedRef.current,
        activeDoctrinePreset
      );

      if (scanAccRef.current >= 280) {
        scanAccRef.current = 0;
        const sensorContext = {
          now: nowIso,
          elapsedMs: elapsedRef.current,
          worldObjects,
        };
        const shouldRunIntermittent = Math.floor(elapsedRef.current / 1000) % 2 === 0;
        const uavEnabled =
          uavSensorMode !== "off" &&
          (uavSensorMode !== "intermittent" || shouldRunIntermittent) &&
          (uavSensorMode !== "active" || doctrineSensorWindowOpen);
        if (uavEnabled) {
          const uavSensor = createUavSensor({
            id: "sensor-uav-eo-1",
            x: nextUavX,
            y: nextUavY,
            range: mode === "scan" ? 180 : 145,
          });
          pendingSignals.push(...uavSensor.scan(sensorContext));
        }

        const radarEnabled =
          radarSensorMode !== "off" &&
          (radarSensorMode !== "intermittent" || shouldRunIntermittent) &&
          (radarSensorMode !== "active" || doctrineSensorWindowOpen);
        if (radarEnabled) {
          const radarSensors = createRadarSensors({
            worldObjects,
            elapsedMs: elapsedRef.current,
          });
          for (const radarSensor of radarSensors) {
            pendingSignals.push(...radarSensor.scan(sensorContext));
          }
        }
      }

      const telemetryEnabled =
        telemetryMode !== "off" &&
        (telemetryMode !== "intermittent" || Math.floor(elapsedRef.current / 1000) % 2 === 0) &&
        (telemetryMode !== "active" || doctrineSensorWindowOpen);
      if (telemetryEnabled) {
        pendingSignals.push(
          ...createAssetTelemetrySignals(assetsRef.current, previousAssetsRef.current, nowIso)
        );
      }
      previousAssetsRef.current = assetsRef.current.map((a) => ({ ...a }));

      const ringFilteredSignals = pendingSignals.filter((signal) =>
        allowsSignalForRing(signal, ringModes, elapsedRef.current)
      );
      ingestSignals(ringFilteredSignals, simNowEpochMs);
      tracksRef.current = updateTracksFromSignals(
        tracksRef.current,
        [],
        simNowEpochMs
      );

      if (
        elapsedRef.current >= nextEvidenceAtSimMsRef.current &&
        factsRevisionRef.current > lastEvidenceRevisionRef.current
      ) {
        nextEvidenceAtSimMsRef.current += EVIDENCE_INTERVAL_MS;
        void runEvidenceCycle();
      }

      blastsRef.current = blastsRef.current
        .map((b) => ({ ...b, lifeMs: b.lifeMs - dt }))
        .filter((b) => b.lifeMs > 0);

      if (elapsedRef.current >= nextSnapshotAtSimMsRef.current) {
        nextSnapshotAtSimMsRef.current += SNAPSHOT_INTERVAL_MS;
        captureSnapshot(simNowEpochMs);
      }

      if (hudAccRef.current >= 90) {
        hudAccRef.current = 0;
        setUav({ ...uavRef.current });
        setThreats([...threatsRef.current]);
        setBlasts([...blastsRef.current]);
        setEvents([...eventsRef.current]);
        setTracks([...tracksRef.current]);
        setAssets([...assetsRef.current]);
        setInterceptions(interceptionsRef.current);
        setAssetHits(assetHitsRef.current);
        setElapsedMs(Math.round(elapsedRef.current));
        setObservedFacts([...factsRef.current]);
      }

      if (!paused && isScenarioOver(assetsRef.current)) {
        setRunning(false);
        captureSnapshot(simNowEpochMs);
        restartTimerRef.current = window.setTimeout(() => {
          startScenario(selectedScenarioKey);
        }, 1600);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    activeOrder,
    activeDoctrinePreset,
    activeScenario,
    doctrine,
    paused,
    radarSensorMode,
    ringModes,
    running,
    telemetryMode,
    timeScale,
    uavSensorMode,
  ]);

  function startScenario(scenarioKey: ScenarioKey = selectedScenarioKey) {
    const scenario = SCENARIOS[scenarioKey];
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    setSnapshots([]);
    setEvents([]);
    setBlasts([]);
    setThreats([]);
    setTracks([]);
    setSelectedTrackId(null);
    setAssets(cloneAssets(scenario.assets));
    setInterceptions(0);
    setAssetHits(0);
    setObservedFacts([]);
    setInterpretation(undefined);
    setGrounding(undefined);
    setIntelStatus("idle");
    setIntelError(undefined);
    setStaffNotes([]);
    setStaffNoteText("");
    setStaffNoteDelayMin(5);
    setElapsedMs(0);
    const initialUav: UavState = { x: FIELD_WIDTH * 0.5, y: FIELD_HEIGHT * 0.28, mode: "patrol" };
    setUav(initialUav);
    uavRef.current = initialUav;
    assetsRef.current = cloneAssets(scenario.assets);
    threatsRef.current = [];
    blastsRef.current = [];
    eventsRef.current = [];
    tracksRef.current = [];
    interceptionsRef.current = 0;
    assetHitsRef.current = 0;
    elapsedRef.current = 0;
    factsRef.current = [];
    groundingRef.current = undefined;
    factCounterRef.current = 0;
    factsRevisionRef.current = 0;
    lastEvidenceRevisionRef.current = 0;
    simStartEpochRef.current = alignedSimStartEpoch(Date.parse(scenario.startIso));
    nextSpawnAtSimMsRef.current = scheduleNextSpawnSimMs(
      0,
      DOCTRINE_PRESETS[scenario.doctrinePreset].spawnCadenceMultiplier *
        scenario.spawnMultiplier
    );
    nextSnapshotAtSimMsRef.current = SNAPSHOT_INTERVAL_MS;
    nextEvidenceAtSimMsRef.current = EVIDENCE_INTERVAL_MS;
    queuedStepMsRef.current = 0;
    previousAssetsRef.current = assetsRef.current.map((a) => ({ ...a }));
    recentSignalKeysRef.current = new Map();
    staffNotesRef.current = [];
    hudAccRef.current = 0;
    scanAccRef.current = 0;
    setPaused(false);
    setTimeScale(1);
    setUavSensorMode("active");
    setRadarSensorMode("active");
    setTelemetryMode("passive");
    setActiveOrder("intercept");
    setRingModes({
      mainBody: "active",
      aawRing: "intermittent",
      aswRing: "passive",
      picketRing: "off",
    });
    setDoctrine(DOCTRINE_PRESETS[scenario.doctrinePreset].doctrine);
    setSelectedDoctrinePresetKey(scenario.doctrinePreset);
    setSelectedScenarioKey(scenario.key);
    setRunning(true);
  }

  function spawnThreat() {
    const aliveAssets = assetsRef.current.filter((a) => a.hp > 0);
    if (aliveAssets.length === 0) return;
    const target = aliveAssets[Math.floor(Math.random() * aliveAssets.length)]!;
    threatIdRef.current += 1;
    const spawnX = Math.random() < 0.5 ? -20 : FIELD_WIDTH + 20;
    const spawnY = 80 + Math.random() * 180;
    threatsRef.current = [
      ...threatsRef.current,
      {
        id: threatIdRef.current,
        x: spawnX,
        y: spawnY,
        speed: 0.08 + Math.random() * 0.12,
        targetAssetId: target.id,
        behavior: "ingress",
      },
    ];
  }

  function queueSimStep(stepMs = STEP_INTERVAL_MS) {
    if (!running) return;
    queuedStepMsRef.current += stepMs;
    if (!paused) {
      setPaused(true);
    }
  }

  function scheduleStaffNote() {
    const trimmed = staffNoteText.trim();
    if (!trimmed) return;
    const delayMs = Math.max(1, staffNoteDelayMin) * 60_000;
    const note: StaffNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: trimmed,
      deliverAtSimMs: elapsedRef.current + delayMs,
      delivered: false,
    };
    const nextNotes = [...staffNotesRef.current, note];
    staffNotesRef.current = nextNotes;
    setStaffNotes(nextNotes);
    setStaffNoteText("");
  }

  function processDueStaffNotes(simNowEpochMs: number) {
    const pending = staffNotesRef.current;
    if (pending.length === 0) return;
    let changed = false;
    const updated = pending.map((note) => {
      if (note.delivered || elapsedRef.current < note.deliverAtSimMs) return note;
      changed = true;
      const event: ScenarioEvent = {
        id: `event-${note.id}`,
        at: new Date(simNowEpochMs).toISOString(),
        kind: "staff-note",
        detail: `STAFF NOTE: ${note.text}`,
      };
      eventsRef.current = [event, ...eventsRef.current].slice(0, 24);
      return { ...note, delivered: true };
    });
    if (changed) {
      staffNotesRef.current = updated;
      setStaffNotes(updated);
    }
  }

  function applyDoctrinePreset(key: DoctrinePreset["key"]) {
    const preset =
      key === "custom" && customDoctrinePreset
        ? customDoctrinePreset
        : DOCTRINE_PRESETS[key];
    setSelectedDoctrinePresetKey(preset.key);
    setDoctrine(preset.doctrine);
    nextSpawnAtSimMsRef.current = Math.min(
      nextSpawnAtSimMsRef.current,
      elapsedRef.current +
        90_000 * preset.spawnCadenceMultiplier * activeScenario.spawnMultiplier
    );
  }

  function saveCustomDoctrinePreset() {
    const custom: DoctrinePreset = {
      key: "custom",
      label: "Custom",
      doctrine,
      spawnCadenceMultiplier: activeDoctrinePreset.spawnCadenceMultiplier,
      sensorSilenceCycleMs: activeDoctrinePreset.sensorSilenceCycleMs,
      sensorActiveWindowMs: activeDoctrinePreset.sensorActiveWindowMs,
    };
    setCustomDoctrinePreset(custom);
    setSelectedDoctrinePresetKey("custom");
    try {
      localStorage.setItem(CUSTOM_DOCTRINE_STORAGE_KEY, JSON.stringify(custom));
    } catch {
      // no-op
    }
  }

  function addBlast(kind: ImpactBlast["kind"], x: number, y: number, radius: number) {
    blastsRef.current = [
      ...blastsRef.current,
      { id: `blast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, x, y, radius, lifeMs: 500, kind },
    ];
  }

  function ingestSignals(signals: RawSensorSignal[], simNowEpochMs: number) {
    const accepted: RawSensorSignal[] = [];
    for (const signal of signals) {
      if (shouldEmitSignal(signal, recentSignalKeysRef.current, 1800)) {
        accepted.push(signal);
      }
    }

    if (accepted.length > 0) {
      const events = accepted.map((signal): ScenarioEvent => ({
        id: `event-${signal.id}`,
        at: signal.at,
        kind: signal.kind,
        detail: signal.message,
        x: signal.x,
        y: signal.y,
        sensorId: signal.sensorId,
        confidence: signal.confidence,
      }));
      eventsRef.current = [...events.reverse(), ...eventsRef.current].slice(0, 24);

      const facts = accepted.map((signal) => {
        factCounterRef.current += 1;
        return signalToObservedFact(signal, factCounterRef.current);
      });
      factsRef.current = [...facts.reverse(), ...factsRef.current].slice(0, 80);
      factsRevisionRef.current += facts.length;
    }

    const previousTracks = tracksRef.current;
    const nextTracks = updateTracksFromSignals(previousTracks, accepted, simNowEpochMs);
    const previousById = new Map(previousTracks.map((track) => [track.id, track]));
    const lifecycleEvents: ScenarioEvent[] = [];
    for (const track of nextTracks) {
      const previous = previousById.get(track.id);
      if (!previous && track.lifecycle === "new") {
        lifecycleEvents.push({
          id: `event-track-new-${track.id}-${Date.now()}`,
          at: new Date(simNowEpochMs).toISOString(),
          kind: "track-lifecycle",
          detail: `TRACK ${track.id} established (${track.classification}, ${Math.round(
            track.confidence * 100
          )}%)`,
        });
      } else if (previous && previous.lifecycle !== track.lifecycle) {
        if (track.lifecycle === "lost") {
          lifecycleEvents.push({
            id: `event-track-lost-${track.id}-${Date.now()}`,
            at: new Date(simNowEpochMs).toISOString(),
            kind: "track-lifecycle",
            detail: `TRACK ${track.id} lost contact after ${Math.round(
              track.staleMs / 1000
            )}s stale`,
          });
        }
        if (track.lifecycle === "reacquired") {
          lifecycleEvents.push({
            id: `event-track-reacq-${track.id}-${Date.now()}`,
            at: new Date(simNowEpochMs).toISOString(),
            kind: "track-lifecycle",
            detail: `TRACK ${track.id} re-acquired (${Math.round(
              track.confidence * 100
            )}% confidence)`,
          });
        }
      }
    }
    if (lifecycleEvents.length > 0) {
      eventsRef.current = [...lifecycleEvents.reverse(), ...eventsRef.current].slice(0, 24);
    }
    tracksRef.current = nextTracks;
  }

  async function runEvidenceCycle() {
    if (factsRef.current.length === 0) return;
    const token = ++evidenceRunTokenRef.current;
    setIntelStatus("running");
    setIntelError(undefined);

    try {
      const recentFacts = [...factsRef.current].slice(0, 24).reverse();
      const { packet } = buildScenarioPacket(
        {
          commanderIntent: "Protect Port A assets while minimizing escalation.",
          facts: recentFacts,
          knownAssets: assetsRef.current.map((a) => a.name),
          constraints: [
            "Do not assume attribution",
            "Do not propose offensive cyber operations",
            "Treat this as a simulated training environment",
          ],
          contextWindow:
            "Autonomous UAV scene simulation with hostile drones targeting critical assets.",
        },
        { includeLowConfidence: true }
      );

      const result = await llmInterpreter(packet);
      const validation = validateGrounding(packet, result.interpretation);
      const validated = extractValidatedActions(result.interpretation, validation);

      if (token !== evidenceRunTokenRef.current) return;

      setInterpretation(result.interpretation);
      setGrounding(validation);
      groundingRef.current = validation;
      setIntelStatus("ready");
      lastEvidenceRevisionRef.current = factsRevisionRef.current;

      if (validated.length === 0 && validation.issues.length > 0) {
        setIntelError("Grounding issues detected: no validated actions in current cycle.");
      }
    } catch (err) {
      if (token !== evidenceRunTokenRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setIntelStatus("error");
      setIntelError(message);
    }
  }

  function damageAsset(assetId: string, amount: number) {
    assetsRef.current = assetsRef.current.map((a) =>
      a.id === assetId ? { ...a, hp: Math.max(0, a.hp - amount) } : a
    );
  }

  function captureSnapshot(simNowEpochMs = simStartEpochRef.current + elapsedRef.current) {
    const nonce = makeNonce();
    const snap: Snapshot = {
      id: `snap-${Date.now()}`,
      at: new Date(simNowEpochMs).toISOString(),
      elapsedMs: Math.round(elapsedRef.current),
      uavX: Math.round(uavRef.current.x),
      uavY: Math.round(uavRef.current.y),
      mode: uavRef.current.mode,
      activeThreats: threatsRef.current.length,
      assetIntegrity: Math.round(averageIntegrity(assetsRef.current)),
      interceptions: interceptionsRef.current,
      assetHits: assetHitsRef.current,
      recentFactIds: factsRef.current.slice(0, 5).map((f) => f.id),
      validatorStatus: groundingRef.current
        ? groundingRef.current.valid
          ? "passed"
          : "failed"
        : "not-run",
      nonce,
    };
    setSnapshots((prev) => [snap, ...prev].slice(0, 12));
  }

  const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
  const timelineTicks = Array.from({ length: 14 }, (_, index) => index);
  const hostileTracks = tracks.filter((track) => track.side === "hostile").length;
  const unknownTracks = tracks.filter((track) => track.side === "unknown").length;
  const reportAlertCount = events.filter(
    (event) => event.kind === "impact-detected" || event.kind === "track-lifecycle"
  ).length;
  const simNowIso = new Date(simStartEpochRef.current + elapsedMs).toISOString();
  const timeCompressionLabel = timeScale === 1 ? "1:1" : `1:${timeScale}`;
  const intermittentPulseOpen = Math.floor(elapsedMs / 1000) % 2 === 0;
  const doctrineSensorWindowOpen = isDoctrineSensorWindowOpen(
    elapsedMs,
    activeDoctrinePreset
  );
  const uavSensorVisible =
    showSensors &&
    uavSensorMode !== "off" &&
    (uavSensorMode !== "intermittent" || intermittentPulseOpen) &&
    (uavSensorMode !== "active" || doctrineSensorWindowOpen);
  const radarSensorVisible =
    showSensors &&
    radarSensorMode !== "off" &&
    (radarSensorMode !== "intermittent" || intermittentPulseOpen) &&
    (radarSensorMode !== "active" || doctrineSensorWindowOpen);
  const uavSensorRange = uav.mode === "scan" ? 180 : 145;
  const radarPlatforms = assets.filter((asset) => asset.kind === "radar");
  const missionDay = Math.floor(elapsedMs / DAY_INTERVAL_MS) + 1;
  const behaviorCounts = threats.reduce(
    (acc, threat) => {
      acc[threat.behavior] += 1;
      return acc;
    },
    { ingress: 0, jink: 0, commit: 0 } as Record<Threat["behavior"], number>
  );
  const scheduleRows = [
    {
      label: "Next Spawn",
      etaMin: Math.max(
        0,
        Math.round((nextSpawnAtSimMsRef.current - elapsedRef.current) / 60000)
      ),
      at: new Date(
        simStartEpochRef.current + Math.max(nextSpawnAtSimMsRef.current, elapsedRef.current)
      ).toISOString(),
    },
    {
      label: "Next Evidence",
      etaMin: Math.max(
        0,
        Math.round((nextEvidenceAtSimMsRef.current - elapsedRef.current) / 60000)
      ),
      at: new Date(
        simStartEpochRef.current + Math.max(nextEvidenceAtSimMsRef.current, elapsedRef.current)
      ).toISOString(),
    },
    {
      label: "Next Snapshot",
      etaMin: Math.max(
        0,
        Math.round((nextSnapshotAtSimMsRef.current - elapsedRef.current) / 60000)
      ),
      at: new Date(
        simStartEpochRef.current + Math.max(nextSnapshotAtSimMsRef.current, elapsedRef.current)
      ).toISOString(),
    },
    {
      label: "Scenario End",
      etaMin: Math.max(
        0,
        Math.round((activeScenario.durationHours * 60 * 60 * 1000 - elapsedRef.current) / 60000)
      ),
      at: new Date(
        simStartEpochRef.current + activeScenario.durationHours * 60 * 60 * 1000
      ).toISOString(),
    },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.commandBar}>
        <div className={styles.commandBarLabel}>Command &amp; Control Bar</div>
        <div className={styles.liveBadge}>LIVE</div>
        <div className={styles.commandMeta}>
          <span>OPS GRID</span>
          <span>TRACKS {tracks.length}</span>
          <span>H-{hostileTracks}</span>
          <span>U-{unknownTracks}</span>
        </div>
        <div className={styles.commandSearch}>{activeScenario.title}</div>
      </div>
      <div className={styles.manualMenuBar}>
        {(["File", "Orders", "Settings", "Reports", "Misc", "Windows", "Help"] as const).map(
          (menu) => (
            <button
              key={menu}
              type="button"
              className={
                activeManualMenu === menu ? styles.manualMenuItemActive : styles.manualMenuItem
              }
              onClick={() => setActiveManualMenu(menu)}
            >
              {menu}
            </button>
          )
        )}
        <span className={styles.manualMenuHint}>{manualMenuHint(activeManualMenu)}</span>
      </div>
      <div className={styles.manualCommandTray}>
        <span className={styles.manualCommandLabel}>{activeManualMenu} Commands</span>
        <div className={styles.manualCommandList}>
          {manualCommands.map((command) => (
            <button
              key={command.id}
              type="button"
              className={styles.manualCommandButton}
              onClick={() => runManualCommand(command)}
            >
              {command.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.header}>
        <div className={styles.titleRow}>
          <strong>PORT A DEFENSE CONSOLE</strong>
          <span className={`${styles.status} ${running ? styles.live : styles.idle}`}>
            {paused ? "paused" : gameStatus}
          </span>
        </div>
        <div className={styles.controls}>
          <select
            className={styles.scenarioSelect}
            value={selectedScenarioKey}
            onChange={(event) => setSelectedScenarioKey(event.target.value as ScenarioKey)}
          >
            {Object.values(SCENARIOS).map((scenario) => (
              <option key={scenario.key} value={scenario.key}>
                {scenario.title}
              </option>
            ))}
          </select>
          <button
            className={styles.button}
            onClick={() => startScenario(selectedScenarioKey)}
          >
            Load Scenario
          </button>
          <button className={styles.button} onClick={() => startScenario()}>
            Restart Scenario
          </button>
          <button className={styles.button} onClick={() => captureSnapshot()} disabled={!running}>
            Capture Snapshot
          </button>
          <button className={styles.button} onClick={() => setPaused((prev) => !prev)}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className={styles.button}
            onClick={() => queueSimStep(STEP_INTERVAL_MS)}
            disabled={!running}
          >
            Step +5m
          </button>
          {DEFAULT_TIME_SCALES.map((mult) => (
            <button
              key={mult}
              className={`${styles.button} ${timeScale === mult ? styles.buttonActive : ""}`}
              onClick={() => setTimeScale(mult)}
            >
              {mult === 1 ? "1:1" : `1:${mult}`}
            </button>
          ))}
          <button className={styles.button} onClick={() => setShowTruth((prev) => !prev)}>
            {showTruth ? "Hide Sim Truth" : "Show Sim Truth"}
          </button>
          <button className={styles.button} onClick={() => setShowSensors((prev) => !prev)}>
            {showSensors ? "Hide Sensors" : "Show Sensors"}
          </button>
        </div>
      </div>

      <div className={styles.hud}>
        <span>Sim Time: {simNowIso}</span>
        <span>Mission Day: D+{missionDay}</span>
        <span>
          Elapsed Sim: {(elapsedMs / 1000).toFixed(1)}s @ {timeCompressionLabel}
        </span>
        <span>Doctrine: {doctrine.profile.toUpperCase()}</span>
        <span>UAV mode: {uav.mode.toUpperCase()}</span>
        <span>Tracks: {tracks.length}</span>
        <span>
          Threat Behavior: ingress {behaviorCounts.ingress} · jink {behaviorCounts.jink} · commit{" "}
          {behaviorCounts.commit}
        </span>
        <span>Interceptions: {interceptions}</span>
        <span>Asset hits: {assetHits}</span>
        <span>Integrity: {Math.round(averageIntegrity(assets))}%</span>
        <span>Facts: {observedFacts.length}</span>
        {overviewTrackContext && (
          <span>
            Overview Focus: {overviewTrackContext.callsign} ·{" "}
            {overviewTrackContext.classification} ·{" "}
            {Math.round(overviewTrackContext.confidence * 100)}%
          </span>
        )}
        <span>
          Validation:{" "}
          {grounding ? (grounding.valid ? "passed" : `failed (${grounding.issues.length})`) : "not-run"}
        </span>
      </div>

      <div className={styles.toolbarTabs}>
        <button className={styles.tabActive} type="button">Situations</button>
        <button className={styles.tab} type="button">Ops</button>
        <button className={styles.tab} type="button">Data</button>
        <button className={styles.tab} type="button">Intel</button>
        <button className={styles.tab} type="button">Orders</button>
      </div>

      <div className={styles.layout}>
        <div className={styles.field} style={{ width: FIELD_WIDTH, height: FIELD_HEIGHT }}>
          <div className={styles.scanline} />
          <div className={styles.globeHalo} />
          <div className={styles.globeRing} />
          <div className={styles.routeArcA} />
          <div className={styles.routeArcB} />
          <div className={styles.routeArcC} />
          <div className={styles.alertBanner}>
            ALERT: NEW THREAT VECTOR DETECTED - PLAN RE-TASK RECOMMENDED
          </div>

          {assets.map((a) => (
            <div key={a.id} className={`${styles.asset} ${styles[`asset-${a.kind}`]}`} style={{ left: a.x, top: a.y }}>
              <span className={styles.assetLabel}>{a.name}</span>
              <span className={styles.assetHp}>{Math.round((a.hp / a.maxHp) * 100)}%</span>
            </div>
          ))}

          <div className={styles.uav} style={{ left: uav.x, top: uav.y }}>
            UAV
          </div>

          {uavSensorVisible && (
            <div
              className={styles.sensorRing}
              style={{
                left: uav.x - uavSensorRange,
                top: uav.y - uavSensorRange,
                width: uavSensorRange * 2,
                height: uavSensorRange * 2,
              }}
            />
          )}

          {radarSensorVisible &&
            radarPlatforms.map((platform, index) => {
              const heading = normalizeDegreesVisual((elapsedMs / 1000) * 42 + index * 120);
              const coneDegrees = 95;
              const range = 260;
              return (
                <div
                  key={`radar-cone-${platform.id}`}
                  className={styles.sensorCone}
                  style={{
                    left: platform.x - range,
                    top: platform.y - range,
                    width: range * 2,
                    height: range * 2,
                    background: `conic-gradient(from ${heading - coneDegrees / 2}deg, rgba(102, 217, 255, 0.25) 0deg ${coneDegrees}deg, transparent ${coneDegrees}deg 360deg)`,
                  }}
                />
              );
            })}

          {tracks.map((track) => (
            <div
              key={`${track.id}-uncertainty`}
              className={styles.uncertainty}
              style={{
                left: track.lastKnownX - track.uncertaintyRadius / 2,
                top: track.lastKnownY - track.uncertaintyRadius / 2,
                width: track.uncertaintyRadius,
                height: track.uncertaintyRadius,
              }}
            />
          ))}

          {tracks
            .filter(
              (track) =>
                track.bearingOnly &&
                track.sensorOriginX !== undefined &&
                track.sensorOriginY !== undefined &&
                track.bearingDeg !== undefined
            )
            .map((track) => {
              const spread = track.bearingSpreadDeg ?? 26;
              const range = track.sectorRange ?? 180;
              const bearing = track.bearingDeg ?? 0;
              return (
                <div
                  key={`${track.id}-bearing`}
                  className={styles.bearingSector}
                  style={{
                    left: (track.sensorOriginX ?? 0) - range,
                    top: (track.sensorOriginY ?? 0) - range,
                    width: range * 2,
                    height: range * 2,
                    background: `conic-gradient(from ${bearing - spread / 2}deg, rgba(255, 209, 102, 0.35) 0deg ${spread}deg, transparent ${spread}deg 360deg)`,
                  }}
                />
              );
            })}

          {tracks.map((track) => (
            !track.bearingOnly && (
              <button
                key={track.id}
                type="button"
                className={`${styles.track} ${styles[`track-${track.side}`]} ${
                  selectedTrackId === track.id ? styles.trackSelected : ""
                }`}
                style={{ left: track.lastKnownX, top: track.lastKnownY }}
                onClick={() => setSelectedTrackId(track.id)}
              >
                {track.side === "hostile" ? "H" : track.side === "friendly" ? "F" : "?"}
              </button>
            )
          ))}

          {showTruth &&
            threats.map((t) => (
              <div key={t.id} className={styles.truthThreat} style={{ left: t.x, top: t.y }} />
            ))}

          {blasts.map((b) => (
            <div
              key={b.id}
              className={`${styles.blast} ${b.kind === "asset-hit" ? styles.blastDanger : styles.blastSafe}`}
              style={{
                left: b.x - b.radius / 2,
                top: b.y - b.radius / 2,
                width: b.radius,
                height: b.radius,
                opacity: clamp(b.lifeMs / 500, 0.1, 1),
              }}
            />
          ))}

          <div className={styles.leftOverlay}>
            <div className={styles.overlayHeader}>Threat Situation</div>
            <div className={styles.overlayBody}>
              <div>Severity: {hostileTracks > 0 ? "CRITICAL" : "ELEVATED"}</div>
              <div>Unknown Air Tracks: {unknownTracks}</div>
              <div>
                Behaviors: I{behaviorCounts.ingress} J{behaviorCounts.jink} C
                {behaviorCounts.commit}
              </div>
              <div>Recommended: Maintain sensor lock + classify</div>
            </div>
          </div>

          <div className={styles.rightOverlay}>
            <div className={styles.overlayHeader}>Detection Queue</div>
            <div className={styles.overlayBody}>
              {events.slice(0, 3).map((event) => (
                <div key={event.id} className={styles.overlayRow}>
                  <span>{event.kind}</span>
                  <span>{event.sensorId ?? "sensor-unknown"}</span>
                </div>
              ))}
              {events.length === 0 && <div>No detections yet.</div>}
            </div>
          </div>
        </div>

        <div className={styles.sidePanels}>
          <div className={styles.snapshotPanel} ref={filePanelRef}>
            <div className={styles.snapshotHeader}>Scenario Briefing</div>
            <div className={styles.snapshotList}>
              <div className={styles.snapshot}>
                <span>title={activeScenario.title}</span>
                <span>theatre={activeScenario.theatre}</span>
                <span>start={activeScenario.startIso}</span>
                <span>duration={activeScenario.durationHours}h</span>
              </div>
              <div className={styles.snapshot}>
                <span>{activeScenario.briefing}</span>
              </div>
              {activeScenario.objectives.map((objective) => {
                const status = evaluateScenarioObjective(objective, {
                  interceptions: interceptionsRef.current,
                  assetHits: assetHitsRef.current,
                  integrity: averageIntegrity(assetsRef.current),
                });
                return (
                  <div key={objective.id} className={styles.snapshot}>
                    <span>{status ? "OBJECTIVE MET" : "OBJECTIVE OPEN"}</span>
                    <span>{objective.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.snapshotPanel} ref={ordersPanelRef}>
            <div className={styles.snapshotHeader}>Show Orders / Staff Notes</div>
            <div className={styles.snapshotList}>
              <div className={styles.snapshot}>
                <span>Primary Orders</span>
                {activeScenario.objectives.map((objective) => (
                  <span key={objective.id}>- {objective.label}</span>
                ))}
              </div>
              <div className={styles.staffNoteComposer}>
                <input
                  className={styles.staffNoteInput}
                  value={staffNoteText}
                  onChange={(event) => setStaffNoteText(event.target.value)}
                  placeholder="Enter staff note reminder..."
                />
                <div className={styles.staffNoteControls}>
                  <select
                    value={staffNoteDelayMin}
                    onChange={(event) => setStaffNoteDelayMin(Number(event.target.value))}
                  >
                    <option value={1}>+1m</option>
                    <option value={5}>+5m</option>
                    <option value={10}>+10m</option>
                    <option value={30}>+30m</option>
                  </select>
                  <button
                    type="button"
                    className={styles.sensorPresetButton}
                    onClick={scheduleStaffNote}
                  >
                    Schedule Note
                  </button>
                </div>
              </div>
              {staffNotes.slice(0, 4).map((note) => (
                <div key={note.id} className={styles.snapshot}>
                  <span>{note.delivered ? "DELIVERED" : "PENDING"}</span>
                  <span>{note.text}</span>
                  <span>
                    at=
                    {new Date(
                      simStartEpochRef.current + Math.max(note.deliverAtSimMs, elapsedRef.current)
                    ).toISOString()}
                  </span>
                </div>
              ))}
              {staffNotes.length === 0 && <div className={styles.empty}>No staff notes scheduled.</div>}
            </div>
          </div>

          <div className={styles.snapshotPanel}>
            <div className={styles.snapshotHeader}>Orders Menu</div>
            <div className={styles.snapshotList}>
              <div className={styles.orderButtons}>
                {(["intercept", "shadow", "scan", "hold-fire"] as const).map((order) => (
                  <button
                    key={order}
                    type="button"
                    className={
                      activeOrder === order
                        ? styles.orderButtonActive
                        : styles.orderButton
                    }
                    onClick={() => setActiveOrder(order)}
                  >
                    {order.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className={styles.snapshot}>
                <span>current-order={activeOrder}</span>
                <span>
                  {activeOrder === "intercept" && "Engage threats when intercept geometry is valid."}
                  {activeOrder === "shadow" && "Maintain offset tracking without aggressive close-in engagement."}
                  {activeOrder === "scan" && "Bias UAV behavior toward search and surveillance posture."}
                  {activeOrder === "hold-fire" && "No kinetic intercepts; maintain contact only."}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.snapshotPanel} ref={miscPanelRef}>
            <div className={styles.snapshotHeader}>Mission Clock / Event Queue</div>
            <div className={styles.snapshotList}>
              <div className={styles.snapshot}>
                <span>simNow={simNowIso}</span>
                <span>day=D+{missionDay}</span>
                <span>timeScale={timeScale}x</span>
                <span>paused={paused ? "yes" : "no"}</span>
              </div>
              {scheduleRows.map((row) => (
                <div key={row.label} className={styles.snapshot}>
                  <span>{row.label}</span>
                  <span>eta={row.etaMin}m</span>
                  <span>at={row.at}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.snapshotPanel} ref={windowsPanelRef}>
            <div className={styles.snapshotHeader}>Contact Status</div>
            <div className={styles.snapshotList}>
              {!selectedTrack ? (
                <div className={styles.empty}>Select a track on tactical plot.</div>
              ) : (
                <div className={styles.contactGrid}>
                  <span>name</span>
                  <strong>{selectedTrack.id}</strong>
                  <span>side</span>
                  <strong>{selectedTrack.side.toUpperCase()}</strong>
                  <span>class</span>
                  <strong>{selectedTrack.classification}</strong>
                  <span>lifecycle</span>
                  <strong>{selectedTrack.lifecycle}</strong>
                  <span>confidence</span>
                  <strong>{Math.round(selectedTrack.confidence * 100)}%</strong>
                  <span>position</span>
                  <strong>
                    {Math.round(selectedTrack.lastKnownX)},{Math.round(selectedTrack.lastKnownY)}
                  </strong>
                  <span>uncertainty</span>
                  <strong>{selectedTrack.uncertaintyRadius}m</strong>
                  <span>bearing-only</span>
                  <strong>{selectedTrack.bearingOnly ? "yes" : "no"}</strong>
                  <span>detections</span>
                  <strong>{selectedTrack.detectionCount}</strong>
                  {selectedTrack.bearingDeg !== undefined && (
                    <>
                      <span>bearing</span>
                      <strong>{Math.round(selectedTrack.bearingDeg)}deg</strong>
                    </>
                  )}
                  {selectedTrack.bearingSpreadDeg !== undefined && (
                    <>
                      <span>bearing spread</span>
                      <strong>{Math.round(selectedTrack.bearingSpreadDeg)}deg</strong>
                    </>
                  )}
                  <span>sensors</span>
                  <strong>{selectedTrack.detectedBy.join(", ")}</strong>
                  <span>stale</span>
                  <strong>{Math.round(selectedTrack.staleMs)}ms</strong>
                </div>
              )}
            </div>
          </div>

          <div className={styles.snapshotPanel} ref={settingsPanelRef}>
            <div className={styles.snapshotHeader}>Sensor Control / EMCON</div>
            <div className={styles.snapshotList}>
              <div className={styles.sensorRow}>
                <span>UAV EO</span>
                <select
                  value={uavSensorMode}
                  onChange={(event) => setUavSensorMode(event.target.value as SensorMode)}
                >
                  <option value="off">OFF</option>
                  <option value="passive">PASSIVE</option>
                  <option value="active">ACTIVE</option>
                  <option value="intermittent">INTERMITTENT</option>
                </select>
              </div>
              <div className={styles.sensorRow}>
                <span>Radar Node</span>
                <select
                  value={radarSensorMode}
                  onChange={(event) => setRadarSensorMode(event.target.value as SensorMode)}
                >
                  <option value="off">OFF</option>
                  <option value="passive">PASSIVE</option>
                  <option value="active">ACTIVE</option>
                  <option value="intermittent">INTERMITTENT</option>
                </select>
              </div>
              <div className={styles.sensorRow}>
                <span>Asset Telemetry</span>
                <select
                  value={telemetryMode}
                  onChange={(event) => setTelemetryMode(event.target.value as SensorMode)}
                >
                  <option value="off">OFF</option>
                  <option value="passive">PASSIVE</option>
                  <option value="active">ACTIVE</option>
                  <option value="intermittent">INTERMITTENT</option>
                </select>
              </div>
              <div className={styles.snapshotHeader}>Mixed Sensor Rings</div>
              {(
                [
                  ["mainBody", "Main Body"],
                  ["aawRing", "AAW Ring"],
                  ["aswRing", "ASW Ring"],
                  ["picketRing", "Picket Ring"],
                ] as const
              ).map(([ringKey, ringLabel]) => (
                <div key={ringKey} className={styles.sensorRow}>
                  <span>{ringLabel}</span>
                  <select
                    value={ringModes[ringKey]}
                    onChange={(event) =>
                      setRingModes((prev) => ({
                        ...prev,
                        [ringKey]: event.target.value as SensorMode,
                      }))
                    }
                  >
                    <option value="off">OFF</option>
                    <option value="passive">PASSIVE</option>
                    <option value="active">ACTIVE</option>
                    <option value="intermittent">INTERMITTENT</option>
                  </select>
                </div>
              ))}
              <div className={styles.snapshotHeader}>Behavior Doctrine</div>
              <div className={styles.sensorRow}>
                <span>Preset</span>
                <select
                  value={selectedDoctrinePresetKey}
                  onChange={(event) =>
                    applyDoctrinePreset(event.target.value as DoctrinePreset["key"])
                  }
                >
                  <option value="harass">HARASS</option>
                  <option value="saturation">SATURATION ATTACK</option>
                  <option value="probing">LOW-SIGNATURE PROBING</option>
                  <option value="custom">CUSTOM</option>
                </select>
              </div>
              <div className={styles.sensorRow}>
                <span>Profile</span>
                <select
                  value={doctrine.profile}
                  onChange={(event) => {
                    const profile = event.target.value as DoctrineProfile;
                    const profileDefaults =
                      profile === "aggressive"
                        ? { evasiveProbability: 0.35, commitRangeMeters: 170 }
                        : profile === "cautious"
                          ? { evasiveProbability: 0.75, commitRangeMeters: 90 }
                          : { evasiveProbability: 0.55, commitRangeMeters: 130 };
                    setDoctrine({ profile, ...profileDefaults });
                    setSelectedDoctrinePresetKey("custom");
                  }}
                >
                  <option value="cautious">CAUTIOUS</option>
                  <option value="balanced">BALANCED</option>
                  <option value="aggressive">AGGRESSIVE</option>
                </select>
              </div>
              <div className={styles.sensorRow}>
                <span>Evasion %</span>
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  value={doctrine.evasiveProbability}
                  onChange={(event) =>
                    {
                      setDoctrine((prev) => ({
                        ...prev,
                        evasiveProbability: Number(event.target.value),
                      }));
                      setSelectedDoctrinePresetKey("custom");
                    }
                  }
                />
                <span>{Math.round(doctrine.evasiveProbability * 100)}%</span>
              </div>
              <div className={styles.sensorRow}>
                <span>Commit Range</span>
                <input
                  type="range"
                  min={70}
                  max={220}
                  step={10}
                  value={doctrine.commitRangeMeters}
                  onChange={(event) =>
                    {
                      setDoctrine((prev) => ({
                        ...prev,
                        commitRangeMeters: Number(event.target.value),
                      }));
                      setSelectedDoctrinePresetKey("custom");
                    }
                  }
                />
                <span>{doctrine.commitRangeMeters}m</span>
              </div>
              <div className={styles.sensorRow}>
                <span>Spawn Cadence</span>
                <span>{activeDoctrinePreset.spawnCadenceMultiplier.toFixed(2)}x base interval</span>
              </div>
              <div className={styles.sensorRow}>
                <span>Sensor Window</span>
                <span>
                  {Math.round(activeDoctrinePreset.sensorActiveWindowMs / 1000)}s active /{" "}
                  {Math.round(
                    (activeDoctrinePreset.sensorSilenceCycleMs -
                      activeDoctrinePreset.sensorActiveWindowMs) /
                      1000
                  )}
                  s quiet
                </span>
              </div>
              <div className={styles.sensorPresetActions}>
                <button
                  type="button"
                  className={styles.sensorPresetButton}
                  onClick={saveCustomDoctrinePreset}
                >
                  Save as Custom
                </button>
                <button
                  type="button"
                  className={styles.sensorPresetButton}
                  onClick={() => applyDoctrinePreset(selectedDoctrinePresetKey)}
                >
                  Re-apply Preset
                </button>
              </div>
            </div>
          </div>

          <div className={styles.snapshotPanel}>
            <div className={styles.snapshotHeader}>Proof snapshots (auto every 2s)</div>
            <div className={styles.snapshotList}>
              {snapshots.length === 0 && <div className={styles.empty}>Scenario auto-runs and records snapshots.</div>}
              {snapshots.map((s) => (
                <div key={s.id} className={styles.snapshot}>
                  <code>{s.at}</code>
                  <span>uav=({s.uavX},{s.uavY})</span>
                  <span>mode={s.mode}</span>
                  <span>thr={s.activeThreats}</span>
                  <span>int={s.interceptions}</span>
                  <span>hits={s.assetHits}</span>
                  <span>hp={s.assetIntegrity}%</span>
                  <span>facts=[{s.recentFactIds.join(",")} ]</span>
                  <span>validator={s.validatorStatus}</span>
                  <span>nonce={s.nonce}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.snapshotPanel} ref={reportsPanelRef}>
            <div className={styles.snapshotHeader}>Report Window / Message Traffic</div>
            <div className={styles.snapshotList}>
              {events.length === 0 && <div className={styles.empty}>Waiting for scans/intercepts/impacts...</div>}
              {events.map((e) => (
                <div key={e.id} className={styles.snapshot}>
                  <code>{e.at}</code>
                  <span>sensor={e.sensorId ?? "unknown"}</span>
                  <span>kind={e.kind}</span>
                  <span>conf={e.confidence ? e.confidence.toFixed(2) : "--"}</span>
                  <span>{e.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.snapshotPanel} ref={helpPanelRef}>
            <div className={styles.snapshotHeader}>Intel / Grounding</div>
            <div className={styles.snapshotList}>
              <div className={styles.snapshot}>
                <span>intelStatus={intelStatus}</span>
                <span>facts={observedFacts.length}</span>
                <span>
                  validator=
                  {grounding ? (grounding.valid ? "passed" : `failed(${grounding.issues.length})`) : "not-run"}
                </span>
                {intelError ? <span>error={intelError}</span> : null}
              </div>
              {observedFacts.slice(0, 6).map((f) => (
                <div key={f.id} className={styles.snapshot}>
                  <span>{f.id}</span>
                  <span>src={f.source}</span>
                  <span>conf={f.confidence}</span>
                  <span>sev={f.severity}</span>
                </div>
              ))}
              {interpretation ? (
                <div className={styles.snapshot}>
                  <span>inferences={interpretation.inferences.length}</span>
                  <span>actions={interpretation.candidateActions.length}</span>
                  <span>usedFacts={interpretation.observedFactsUsed.slice(0, 5).join(",")}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.timeline}>
        <span className={styles.timelineLabel}>Last Alert</span>
        <div className={styles.timelineTrack}>
          {timelineTicks.map((tick) => (
            <span key={tick} className={styles.timelineTick}>
              {tick}
            </span>
          ))}
        </div>
        <span className={styles.timelineNow}>Now</span>
      </div>
      <div className={styles.statusBarClassic}>
        <span>Main window</span>
        <span>Menu: {activeManualMenu}</span>
        <span>Time Compression: {timeCompressionLabel}</span>
        <span>Report window entries: {events.length}</span>
        <span>Report alerts: {reportAlertCount}</span>
        <span>Show Orders: {activeOrder.toUpperCase()}</span>
        <span>Selected contact: {selectedTrack?.id ?? "none"}</span>
      </div>
    </div>
  );
}

function manualMenuHint(menu: ManualMenu): string {
  if (menu === "File") return "Scenario load/restart and persistence controls.";
  if (menu === "Orders") return "Issue intercept/shadow/scan/hold-fire directives.";
  if (menu === "Settings") return "Time compression and sensor posture.";
  if (menu === "Reports") return "Message traffic, show orders, and contact status.";
  if (menu === "Misc") return "Range/bearing utilities and staff tools.";
  if (menu === "Windows") return "Switch between map, reports, and panels.";
  return "Reference glossary and operator guidance.";
}

function buildManualCommands(menu: ManualMenu): ManualCommand[] {
  const byMenu: Record<ManualMenu, ManualCommand[]> = {
    File: [
      { id: "file-load-scenario", label: "Load Scenario", menu: "File", action: "execute" },
      { id: "file-restart", label: "Restart Scenario", menu: "File", action: "execute" },
      { id: "file-save-snapshot", label: "Save Snapshot", menu: "File", action: "execute" },
    ],
    Orders: [
      { id: "orders-attack", label: "Attack", menu: "Orders", action: "execute" },
      {
        id: "orders-sensors",
        label: "Sensors",
        menu: "Orders",
        action: "navigate",
        targetMenu: "Settings",
      },
      {
        id: "orders-staff-note",
        label: "Enter Staff Note",
        menu: "Orders",
        action: "navigate",
        targetMenu: "Orders",
      },
    ],
    Settings: [
      { id: "settings-cycle-time", label: "Time Compression", menu: "Settings", action: "execute" },
      {
        id: "settings-toggle-sensors",
        label: "Toggle Sensor Overlay",
        menu: "Settings",
        action: "execute",
      },
      { id: "settings-pause", label: "Pause / Resume", menu: "Settings", action: "execute" },
    ],
    Reports: [
      {
        id: "reports-show-orders",
        label: "Show Orders",
        menu: "Reports",
        action: "navigate",
        targetMenu: "Orders",
      },
      {
        id: "reports-platform-display",
        label: "Platform Display",
        menu: "Reports",
        action: "navigate",
        targetMenu: "Windows",
      },
      {
        id: "reports-staff-report",
        label: "Staff Report",
        menu: "Reports",
        action: "navigate",
        targetMenu: "Help",
      },
    ],
    Misc: [
      {
        id: "misc-range-bearing",
        label: "Calc Range & Bearing",
        menu: "Misc",
        action: "navigate",
        targetMenu: "Windows",
      },
      { id: "misc-snapshot", label: "Capture Snapshot", menu: "Misc", action: "execute" },
      { id: "misc-truth-toggle", label: "Toggle Truth Layer", menu: "Misc", action: "execute" },
    ],
    Windows: [
      {
        id: "windows-map",
        label: "Main Window",
        menu: "Windows",
        action: "navigate",
        targetMenu: "Windows",
      },
      {
        id: "windows-reports",
        label: "Report Window",
        menu: "Windows",
        action: "navigate",
        targetMenu: "Reports",
      },
      {
        id: "windows-intel",
        label: "Intel Window",
        menu: "Windows",
        action: "navigate",
        targetMenu: "Help",
      },
    ],
    Help: [
      {
        id: "help-operator-guide",
        label: "Operator Guide",
        menu: "Help",
        action: "navigate",
        targetMenu: "Help",
      },
      {
        id: "help-command-summary",
        label: "Command Summary",
        menu: "Help",
        action: "navigate",
        targetMenu: "Reports",
      },
      {
        id: "help-keyboard",
        label: "Keyboard Commands",
        menu: "Help",
        action: "navigate",
        targetMenu: "Settings",
      },
    ],
  };
  return byMenu[menu] ?? [];
}

function normalizeDegreesVisual(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function computeUavMotion(
  uav: UavState,
  threats: Threat[],
  dt: number,
  order: OperationalOrder
): UavState {
  const speed = 0.24 * dt;
  if (order === "scan") {
    const patrolX = FIELD_WIDTH * 0.5 + Math.sin(performance.now() / 1400) * 250;
    const patrolY = FIELD_HEIGHT * 0.32 + Math.cos(performance.now() / 1300) * 58;
    return {
      x: approach(uav.x, patrolX, speed),
      y: approach(uav.y, patrolY, speed * 0.55),
      mode: "scan",
    };
  }
  if (threats.length === 0) {
    const patrolX = FIELD_WIDTH * 0.5 + Math.sin(performance.now() / 1800) * 220;
    const patrolY = FIELD_HEIGHT * 0.28 + Math.cos(performance.now() / 1600) * 40;
    return {
      x: approach(uav.x, patrolX, speed),
      y: approach(uav.y, patrolY, speed * 0.5),
      mode: "patrol",
    };
  }

  const highestRisk = [...threats].sort((a, b) => b.y - a.y)[0]!;
  const trackingOffset = order === "shadow" ? 110 : 40;
  const targetX = highestRisk.x;
  const targetY = highestRisk.y - trackingOffset;
  const mode =
    order === "hold-fire"
      ? "scan"
      : distance(uav.x, uav.y, targetX, targetY) < 80
        ? "scan"
        : "intercept";
  return {
    x: approach(uav.x, targetX, speed),
    y: approach(uav.y, targetY, speed * 0.8),
    mode,
  };
}

function cloneAssets(assets: Asset[]): Asset[] {
  return assets.map((asset) => ({ ...asset }));
}

function alignedSimStartEpoch(nowMs: number): number {
  const start = new Date(nowMs);
  start.setSeconds(0, 0);
  return start.getTime();
}

function scheduleNextSpawnSimMs(fromSimMs: number, cadenceMultiplier = 1): number {
  const jitterMs = 90_000 + Math.random() * 210_000;
  return fromSimMs + jitterMs * cadenceMultiplier;
}

function isDoctrineSensorWindowOpen(
  elapsedMs: number,
  preset: DoctrinePreset
): boolean {
  if (preset.sensorSilenceCycleMs <= 0) return true;
  const offset = elapsedMs % preset.sensorSilenceCycleMs;
  return offset <= preset.sensorActiveWindowMs;
}

function allowsSignalForRing(
  signal: RawSensorSignal,
  ringModes: SensorRingModes,
  elapsedMs: number
): boolean {
  const ring = resolveSignalRing(signal);
  const mode = ringModes[ring];
  if (mode === "off") return false;
  if (mode === "intermittent") {
    return Math.floor(elapsedMs / 1000) % 2 === 0;
  }
  return true;
}

function resolveSignalRing(signal: RawSensorSignal): keyof SensorRingModes {
  const distanceFromSensor =
    typeof signal.metadata?.distanceFromSensor === "number"
      ? signal.metadata.distanceFromSensor
      : signal.kind === "impact-detected" || signal.kind === "intercept-detected"
        ? 50
        : 180;
  if (distanceFromSensor <= 80) return "mainBody";
  if (distanceFromSensor <= 150) return "aawRing";
  if (distanceFromSensor <= 230) return "aswRing";
  return "picketRing";
}

function evaluateScenarioObjective(
  objective: ScenarioObjective,
  metrics: { interceptions: number; assetHits: number; integrity: number }
): boolean {
  const actual =
    objective.metric === "interceptions"
      ? metrics.interceptions
      : objective.metric === "assetHits"
        ? metrics.assetHits
        : metrics.integrity;
  return objective.comparator === "gte" ? actual >= objective.value : actual <= objective.value;
}

function computeThreatMovement(
  threat: Threat,
  target: Asset,
  uav: { x: number; y: number },
  elapsedMs: number,
  doctrine: DoctrineState
): { behavior: Threat["behavior"]; dir: { x: number; y: number }; speed: number } {
  const toTarget = normalize(target.x - threat.x, target.y - threat.y);
  const distanceToUav = distance(threat.x, threat.y, uav.x, uav.y);
  const distanceToTarget = distance(threat.x, threat.y, target.x, target.y);
  const shouldJink =
    distanceToUav < 110 &&
    Math.abs(Math.sin(elapsedMs / 750 + threat.id * 0.7)) < doctrine.evasiveProbability;

  if (shouldJink) {
    const lateral = { x: -toTarget.y, y: toTarget.x };
    const weave = Math.sin(elapsedMs / 900 + threat.id) * 0.7;
    const blended = normalize(
      toTarget.x * 0.75 + lateral.x * weave * 0.45,
      toTarget.y * 0.75 + lateral.y * weave * 0.45
    );
    const jinkSpeedMultiplier = doctrine.profile === "cautious" ? 0.95 : 1.08;
    return { behavior: "jink", dir: blended, speed: threat.speed * jinkSpeedMultiplier };
  }

  if (distanceToTarget < doctrine.commitRangeMeters) {
    const commitSpeedMultiplier =
      doctrine.profile === "aggressive"
        ? 1.35
        : doctrine.profile === "cautious"
          ? 1.12
          : 1.25;
    return { behavior: "commit", dir: toTarget, speed: threat.speed * commitSpeedMultiplier };
  }

  const ingressSpeedMultiplier = doctrine.profile === "cautious" ? 0.95 : 1;
  return { behavior: "ingress", dir: toTarget, speed: threat.speed * ingressSpeedMultiplier };
}

function averageIntegrity(assets: Asset[]): number {
  if (assets.length === 0) return 0;
  const total = assets.reduce((sum, a) => sum + (a.hp / a.maxHp) * 100, 0);
  return total / assets.length;
}

function isScenarioOver(assets: Asset[]): boolean {
  return assets.every((a) => a.hp <= 0);
}

function normalize(dx: number, dy: number): { x: number; y: number } {
  const mag = Math.hypot(dx, dy) || 1;
  return { x: dx / mag, y: dy / mag };
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function approach(current: number, target: number, step: number): number {
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function makeNonce(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] ?? 0).toString(36);
}
