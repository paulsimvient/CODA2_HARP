import type {
  ConfidenceLevel,
  FactDomain,
  ObservedFact,
  RawSourceReport,
  SeverityLevel,
} from "./types";

// ─── Fact normalizer ──────────────────────────────────────────────────────────
//
// Converts raw source reports into structured ObservedFact records.
//
// This runs deterministically before anything reaches the LLM.
// The LLM cannot influence what facts exist — it can only interpret
// facts that were normalized here.

let factCounter = 0;

/**
 * Normalizes a raw source report into an ObservedFact.
 *
 * In production, this would:
 *   - Parse sensor data formats (AIS, radar tracks, SIGINT feeds)
 *   - Cross-reference entity databases for canonical names
 *   - Apply confidence heuristics from source trust ratings
 *   - Deduplicate against existing fact store
 *
 * For now it applies rule-based normalization.
 */
export function normalizeReport(report: RawSourceReport): ObservedFact {
  factCounter += 1;
  const id = `fact_${report.domain.toLowerCase()}_${String(factCounter).padStart(3, "0")}`;

  return {
    id,
    domain: report.domain,
    entity: extractEntity(report),
    event: extractEvent(report),
    time: report.timestamp,
    location: extractLocation(report),
    coordinates: extractCoordinates(report),
    source: report.source,
    confidence: deriveConfidence(report),
    severity: deriveSeverity(report),
    rawEvidenceRef: report.reportId,
  };
}

/**
 * Normalizes a batch of reports and deduplicates by event similarity.
 */
export function normalizeBatch(reports: RawSourceReport[]): ObservedFact[] {
  const normalized = reports.map(normalizeReport);
  return deduplicateFacts(normalized);
}

// Scenario fixtures — see factSets.ts and src/scenarios/*.json
export {
  DEFAULT_FACT_SET_ID,
  FactSetLoadError,
  listAvailableFactSets,
  loadFactSet,
  stubPortAFacts,
  validateObservedFact,
  validateObservedFacts,
} from "./factSets";
export type { FactSetDescriptor } from "./factSets";

// ─── Internal utilities ───────────────────────────────────────────────────────

function extractEntity(report: RawSourceReport): string {
  const meta = report.metadata as Record<string, string> | undefined;
  return meta?.["entity"] ?? inferEntityFromText(report.text);
}

function extractEvent(report: RawSourceReport): string {
  const meta = report.metadata as Record<string, string> | undefined;
  return meta?.["event"] ?? report.text.slice(0, 80).trim();
}

function extractLocation(report: RawSourceReport): string | undefined {
  const meta = report.metadata as Record<string, string> | undefined;
  return meta?.["location"];
}

function extractCoordinates(
  report: RawSourceReport
): { lat: number; lng: number } | undefined {
  const meta = report.metadata as Record<string, unknown> | undefined;
  const lat = Number(meta?.["lat"]);
  const lng = Number(meta?.["lng"]);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return undefined;
}

function deriveConfidence(report: RawSourceReport): ConfidenceLevel {
  const meta = report.metadata as Record<string, string> | undefined;
  const explicit = meta?.["confidence"] as ConfidenceLevel | undefined;
  if (explicit && ["low", "medium", "high"].includes(explicit)) return explicit;

  // Source-based heuristics
  const src = report.source.toLowerCase();
  if (src.includes("confirmed") || src.includes("multi-source")) return "high";
  if (src.includes("single") || src.includes("rumor") || src.includes("osint")) return "low";
  return "medium";
}

function deriveSeverity(report: RawSourceReport): SeverityLevel {
  const meta = report.metadata as Record<string, string> | undefined;
  const explicit = meta?.["severity"] as SeverityLevel | undefined;
  if (explicit && ["low", "medium", "high", "critical"].includes(explicit)) return explicit;

  // Domain-based defaults
  const domainDefaults: Record<FactDomain, SeverityLevel> = {
    UAS: "medium",
    cyber: "high",
    maritime: "medium",
    ground: "high",
    air: "high",
    space: "medium",
    information: "low",
    logistics: "medium",
    signals: "medium",
  };

  return domainDefaults[report.domain] ?? "medium";
}

function inferEntityFromText(text: string): string {
  // Very naive — in production this calls an entity extraction model
  const portMatch = text.match(/Port [A-Z]/);
  if (portMatch?.[0]) return portMatch[0];
  return "Unknown entity";
}

function deduplicateFacts(facts: ObservedFact[]): ObservedFact[] {
  // Simple deduplication: drop facts with identical entity + event + time
  const seen = new Set<string>();
  return facts.filter((f) => {
    const key = `${f.entity}|${f.event}|${f.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
