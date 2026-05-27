import { clamp } from "./utils";
import type { AssetWorldState, WorldObject, WorldObjectKind } from "./world";

export type RawSignalKind =
  | "object-detected"
  | "object-lost"
  | "proximity-warning"
  | "impact-detected"
  | "intercept-detected"
  | "asset-health-change";

export type RawSensorSignal = {
  id: string;
  sensorId: string;
  sensorType: "uav-eo" | "radar" | "asset-telemetry" | "fusion";
  kind: RawSignalKind;
  at: string;
  objectId?: string;
  objectKind?: WorldObjectKind;
  x?: number;
  y?: number;
  confidence: number;
  severityHint: "low" | "medium" | "high" | "critical";
  message: string;
  metadata?: Record<string, unknown>;
};

export type SensorContext = {
  now: string;
  elapsedMs: number;
  worldObjects: WorldObject[];
};

export type Sensor = {
  id: string;
  type: RawSensorSignal["sensorType"];
  x: number;
  y: number;
  range: number;
  scan: (ctx: SensorContext) => RawSensorSignal[];
};

type WorldSignalInput = Omit<RawSensorSignal, "id" | "at">;

export function createWorldChangeSignalFactory(now: string) {
  return (input: WorldSignalInput): RawSensorSignal => ({
    ...input,
    id: makeSignalId(),
    at: now,
  });
}

export function createUavSensor(input: {
  id: string;
  x: number;
  y: number;
  range: number;
}): Sensor {
  return {
    id: input.id,
    type: "uav-eo",
    x: input.x,
    y: input.y,
    range: input.range,
    scan(ctx) {
      const signals: RawSensorSignal[] = [];
      const occluders = ctx.worldObjects.filter((obj) => obj.kind === "asset");

      for (const obj of ctx.worldObjects) {
        if (!obj.observable || obj.kind !== "hostile-drone") continue;
        const d = distance(this.x, this.y, obj.x, obj.y);
        if (d > this.range) continue;
        if (!hasLineOfSight(this.x, this.y, obj.x, obj.y, occluders)) continue;

        const bearing = bearingDegrees(this.x, this.y, obj.x, obj.y);
        const isBearingOnly = d > this.range * 0.64;
        const confidence = isBearingOnly
          ? clamp(1 - d / this.range, 0.28, 0.62)
          : clamp(1 - d / this.range, 0.45, 0.95);
        const severityHint: RawSensorSignal["severityHint"] = d < 80 ? "high" : "medium";
        signals.push({
          id: makeSignalId(),
          sensorId: this.id,
          sensorType: this.type,
          kind: d < 60 ? "proximity-warning" : "object-detected",
          at: ctx.now,
          objectId: obj.id,
          objectKind: obj.kind,
          x: isBearingOnly ? undefined : Math.round(obj.x),
          y: isBearingOnly ? undefined : Math.round(obj.y),
          confidence,
          severityHint,
          message:
            d < 60 && !isBearingOnly
              ? `UAV EO proximity warning: unidentified drone near defended lane at scene(${Math.round(obj.x)},${Math.round(obj.y)})`
              : isBearingOnly
                ? `UAV EO bearing-only return: unknown air contact on bearing ${Math.round(bearing)}deg`
                : `UAV EO detected unidentified drone at scene(${Math.round(obj.x)},${Math.round(obj.y)})`,
          metadata: {
            distanceFromSensor: Math.round(d),
            elapsedMs: Math.round(ctx.elapsedMs),
            bearingOnly: isBearingOnly,
            bearingDeg: Math.round(bearing),
            bearingSpreadDeg: isBearingOnly ? 22 : 8,
            sensorX: Math.round(this.x),
            sensorY: Math.round(this.y),
            sectorRange: Math.round(this.range),
            losClear: true,
          },
        });
      }

      return signals;
    },
  };
}

export function createRadarSensors(input: {
  worldObjects: WorldObject[];
  elapsedMs: number;
  range?: number;
  coneDegrees?: number;
}): Sensor[] {
  const range = input.range ?? 260;
  const coneDegrees = input.coneDegrees ?? 95;
  const radarPlatforms = input.worldObjects.filter(
    (obj) => obj.kind === "asset" && obj.id.includes("radar")
  );

  return radarPlatforms.map((platform, index) => {
    const heading = normalizeDegrees((input.elapsedMs / 1000) * 42 + index * 120);
    return {
      id: `sensor-radar-${platform.id}`,
      type: "radar",
      x: platform.x,
      y: platform.y,
      range,
      scan(ctx) {
        const signals: RawSensorSignal[] = [];
        const occluders = ctx.worldObjects.filter(
          (obj) => obj.kind === "asset" && obj.id !== platform.id
        );
        for (const obj of ctx.worldObjects) {
          if (!obj.observable || obj.kind !== "hostile-drone") continue;

          const d = distance(this.x, this.y, obj.x, obj.y);
          if (d > this.range) continue;

          const bearing = bearingDegrees(this.x, this.y, obj.x, obj.y);
          const angleOffset = angularDistanceDegrees(heading, bearing);
          if (angleOffset > coneDegrees / 2) continue;
          if (!hasLineOfSight(this.x, this.y, obj.x, obj.y, occluders)) continue;

          const rangeScore = 1 - d / this.range;
          const coneScore = 1 - angleOffset / (coneDegrees / 2);
          const confidence = clamp(rangeScore * 0.65 + coneScore * 0.35, 0.32, 0.78);
          signals.push({
            id: makeSignalId(),
            sensorId: this.id,
            sensorType: this.type,
            kind: d < 90 ? "proximity-warning" : "object-detected",
            at: ctx.now,
            objectId: obj.id,
            objectKind: obj.kind,
            x: undefined,
            y: undefined,
            confidence,
            severityHint: d < 70 ? "high" : "medium",
            message:
              d < 90
                ? `Radar bearing warning: unknown air contact closing toward ${platform.name} on bearing ${Math.round(bearing)}deg`
                : `Radar bearing-only track: unknown air contact on bearing ${Math.round(bearing)}deg from ${platform.name}`,
            metadata: {
              bearingOnly: true,
              radarHeadingDeg: Math.round(heading),
              bearingDeg: Math.round(bearing),
              bearingSpreadDeg: Math.max(12, Math.round(coneDegrees * 0.35)),
              coneDegrees,
              sensorX: Math.round(this.x),
              sensorY: Math.round(this.y),
              sectorRange: Math.round(this.range),
              distanceFromSensor: Math.round(d),
              losClear: true,
            },
          });
        }
        return signals;
      },
    };
  });
}

export function createAssetTelemetrySignals(
  currentAssets: AssetWorldState[],
  previousAssets: AssetWorldState[],
  now: string
): RawSensorSignal[] {
  const signals: RawSensorSignal[] = [];
  for (const asset of currentAssets) {
    const previous = previousAssets.find((a) => a.id === asset.id);
    if (!previous) continue;
    if (asset.hp >= previous.hp) continue;

    const ratio = asset.maxHp > 0 ? asset.hp / asset.maxHp : 0;
    signals.push({
      id: makeSignalId(),
      sensorId: `telemetry-${asset.id}`,
      sensorType: "asset-telemetry",
      kind: "asset-health-change",
      at: now,
      objectId: asset.id,
      objectKind: "asset",
      x: Math.round(asset.x),
      y: Math.round(asset.y),
      confidence: 0.98,
      severityHint: ratio <= 0.5 ? "critical" : "high",
      message: `${asset.name} telemetry reports integrity drop from ${previous.hp} to ${asset.hp}`,
      metadata: {
        assetName: asset.name,
        previousHp: previous.hp,
        currentHp: asset.hp,
      },
    });
  }
  return signals;
}

function makeSignalId(): string {
  return `sig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function hasLineOfSight(
  sensorX: number,
  sensorY: number,
  targetX: number,
  targetY: number,
  occluders: WorldObject[]
): boolean {
  for (const blocker of occluders) {
    const blockerRadius = 16;
    if (
      pointSegmentDistance(
        blocker.x,
        blocker.y,
        sensorX,
        sensorY,
        targetX,
        targetY
      ) < blockerRadius
    ) {
      return false;
    }
  }
  return true;
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby || 1;
  const apx = px - ax;
  const apy = py - ay;
  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return distance(px, py, cx, cy);
}

function bearingDegrees(ax: number, ay: number, bx: number, by: number): number {
  const radians = Math.atan2(by - ay, bx - ax);
  return normalizeDegrees((radians * 180) / Math.PI);
}

function normalizeDegrees(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function angularDistanceDegrees(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}
