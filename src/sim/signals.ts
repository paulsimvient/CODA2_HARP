import type { RawSensorSignal } from "./sensors";

export function shouldEmitSignal(
  signal: RawSensorSignal,
  recentSignalKeys: Map<string, number>,
  cooldownMs = 1800,
  nowMs = performance.now()
): boolean {
  const key = [
    signal.sensorId,
    signal.kind,
    signal.objectId ?? "none",
    Math.round((signal.x ?? 0) / 25),
    Math.round((signal.y ?? 0) / 25),
  ].join(":");

  const last = recentSignalKeys.get(key) ?? 0;
  if (nowMs - last < cooldownMs) return false;
  recentSignalKeys.set(key, nowMs);
  return true;
}
