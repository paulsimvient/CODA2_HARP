import type { ObservedFact } from "../intel/types";
import type { RawSensorSignal } from "./sensors";

export function signalToObservedFact(
  signal: RawSensorSignal,
  factCounter: number
): ObservedFact {
  const confidence: ObservedFact["confidence"] =
    signal.confidence >= 0.8
      ? "high"
      : signal.confidence >= 0.55
        ? "medium"
        : "low";

  const domain: ObservedFact["domain"] =
    signal.objectKind === "hostile-drone"
      ? "UAS"
      : signal.sensorType === "asset-telemetry"
        ? "ground"
        : "signals";

  const entity =
    typeof signal.metadata?.assetName === "string"
      ? signal.metadata.assetName
      : signal.objectId ?? "scene-object";

  return {
    id: `fact_sim_${String(factCounter).padStart(4, "0")}`,
    domain,
    entity,
    event: signal.message,
    time: signal.at,
    location:
      signal.x !== undefined && signal.y !== undefined
        ? `scene(${signal.x},${signal.y})`
        : undefined,
    source: signal.sensorId,
    confidence,
    severity: signal.severityHint,
    rawEvidenceRef: `signal:${signal.id}`,
  };
}
