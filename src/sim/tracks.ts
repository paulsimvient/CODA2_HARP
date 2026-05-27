import type { RawSensorSignal } from "./sensors";
const TRACK_MAX_STALE_MS = 6 * 60 * 60 * 1000;

export type TrackSide = "friendly" | "hostile" | "unknown" | "neutral";

export type TrackClassification =
  | "unknown-air"
  | "uas"
  | "asset"
  | "impact"
  | "sensor-return";

export type TrackFile = {
  id: string;
  side: TrackSide;
  classification: TrackClassification;
  confidence: number;
  lastKnownX: number;
  lastKnownY: number;
  uncertaintyRadius: number;
  bearingOnly: boolean;
  bearingDeg?: number;
  bearingSpreadDeg?: number;
  sensorOriginX?: number;
  sensorOriginY?: number;
  sectorRange?: number;
  courseDeg?: number;
  speed?: number;
  detectedBy: string[];
  lastDetectionAt: string;
  sourceSignalIds: string[];
  staleMs: number;
  detectionCount: number;
  lifecycle: "new" | "tracking" | "lost" | "reacquired";
};

const TRACK_LOST_THRESHOLD_MS = 4 * 60 * 1000;
const TRACK_NEW_TO_TRACKING_MS = 45 * 1000;

export function updateTracksFromSignals(
  previousTracks: TrackFile[],
  signals: RawSensorSignal[],
  nowMs: number
): TrackFile[] {
  const tracks = previousTracks.map((track) => {
    const staleMs = Math.max(0, nowMs - Date.parse(track.lastDetectionAt));
    if (staleMs >= TRACK_LOST_THRESHOLD_MS) {
      return { ...track, staleMs, lifecycle: "lost" as const };
    }
    if (
      (track.lifecycle === "new" || track.lifecycle === "reacquired") &&
      staleMs > TRACK_NEW_TO_TRACKING_MS
    ) {
      return { ...track, staleMs, lifecycle: "tracking" as const };
    }
    return { ...track, staleMs };
  });

  for (const signal of signals) {
    if (!signal.objectId) continue;
    const existing = tracks.find((track) => track.id === signal.objectId);
    if (!existing) {
      const bearingOnly = Boolean(signal.metadata?.bearingOnly);
      const sensorOriginX = numberOrUndefined(signal.metadata?.sensorX);
      const sensorOriginY = numberOrUndefined(signal.metadata?.sensorY);
      tracks.unshift({
        id: signal.objectId,
        side: signal.objectKind === "asset" ? "friendly" : "unknown",
        classification: bearingOnly ? "unknown-air" : classifySignal(signal),
        confidence: signal.confidence,
        lastKnownX: signal.x ?? sensorOriginX ?? 0,
        lastKnownY: signal.y ?? sensorOriginY ?? 0,
        uncertaintyRadius: bearingOnly
          ? Math.max(180, uncertaintyFromConfidence(signal.confidence))
          : uncertaintyFromConfidence(signal.confidence),
        bearingOnly,
        bearingDeg: numberOrUndefined(signal.metadata?.bearingDeg),
        bearingSpreadDeg: numberOrUndefined(signal.metadata?.bearingSpreadDeg),
        sensorOriginX,
        sensorOriginY,
        sectorRange: numberOrUndefined(signal.metadata?.sectorRange),
        detectedBy: [signal.sensorId],
        lastDetectionAt: signal.at,
        sourceSignalIds: [signal.id],
        staleMs: 0,
        detectionCount: 1,
        lifecycle: "new",
      });
      continue;
    }

    const isBearingOnly = Boolean(signal.metadata?.bearingOnly);
    const hasPositionFix = signal.x !== undefined && signal.y !== undefined;
    const confidenceBoost = isBearingOnly ? 0.06 : 0.13;
    existing.confidence = clamp01(
      Math.max(existing.confidence, signal.confidence, existing.confidence + confidenceBoost)
    );
    if (hasPositionFix) {
      existing.lastKnownX = signal.x ?? existing.lastKnownX;
      existing.lastKnownY = signal.y ?? existing.lastKnownY;
      existing.bearingOnly = false;
    } else if (isBearingOnly) {
      existing.bearingOnly = true;
      existing.sensorOriginX = numberOrUndefined(signal.metadata?.sensorX) ?? existing.sensorOriginX;
      existing.sensorOriginY = numberOrUndefined(signal.metadata?.sensorY) ?? existing.sensorOriginY;
      existing.bearingDeg = numberOrUndefined(signal.metadata?.bearingDeg) ?? existing.bearingDeg;
      existing.bearingSpreadDeg =
        numberOrUndefined(signal.metadata?.bearingSpreadDeg) ?? existing.bearingSpreadDeg;
      existing.sectorRange = numberOrUndefined(signal.metadata?.sectorRange) ?? existing.sectorRange;
      if (existing.sensorOriginX !== undefined) existing.lastKnownX = existing.sensorOriginX;
      if (existing.sensorOriginY !== undefined) existing.lastKnownY = existing.sensorOriginY;
    }
    existing.uncertaintyRadius = existing.bearingOnly
      ? Math.max(170, uncertaintyFromConfidence(existing.confidence))
      : uncertaintyFromConfidence(existing.confidence);
    existing.detectedBy = Array.from(new Set([...existing.detectedBy, signal.sensorId]));
    existing.lastDetectionAt = signal.at;
    existing.sourceSignalIds = [...existing.sourceSignalIds, signal.id].slice(-8);
    existing.staleMs = 0;
    existing.detectionCount += 1;
    existing.lifecycle = existing.lifecycle === "lost" ? "reacquired" : "tracking";

    if (
      !existing.bearingOnly &&
      existing.classification === "unknown-air" &&
      (signal.confidence >= 0.55 || existing.detectionCount >= 3)
    ) {
      existing.classification = signal.objectKind === "hostile-drone" ? "uas" : classifySignal(signal);
    }
    if (
      signal.objectKind === "hostile-drone" &&
      existing.classification === "uas" &&
      existing.confidence >= 0.78 &&
      existing.detectionCount >= 4
    ) {
      existing.side = "hostile";
    }
  }

  return tracks
    .filter((track) => track.staleMs < TRACK_MAX_STALE_MS)
    .sort((a, b) => b.lastDetectionAt.localeCompare(a.lastDetectionAt))
    .slice(0, 40);
}

function classifySignal(signal: RawSensorSignal): TrackClassification {
  if (signal.kind === "impact-detected") return "impact";
  if (signal.objectKind === "asset") return "asset";
  if (signal.objectKind === "hostile-drone") {
    return signal.confidence >= 0.55 ? "uas" : "unknown-air";
  }
  return "sensor-return";
}

function uncertaintyFromConfidence(confidence: number): number {
  const clamped = clamp01(confidence);
  return Math.max(24, Math.round((1 - clamped) * 180));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
