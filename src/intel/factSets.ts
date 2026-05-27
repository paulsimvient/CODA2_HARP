import type {
  ConfidenceLevel,
  FactDomain,
  ObservedFact,
  SeverityLevel,
} from "./types";

// ─── Scenario fact sets ───────────────────────────────────────────────────────
//
// Demo / fixture facts live under src/scenarios/*.json and are discovered at
// build time via Vite's import.meta.glob. Add a new JSON file to register a
// scenario — no code changes required.

/** Default scenario used by the intel pipeline and map fallback. */
export const DEFAULT_FACT_SET_ID = "port-a";

export type FactSetDescriptor = {
  id: string;
  name: string;
  description?: string;
  factCount: number;
};

type ScenarioFactSetFile = {
  id: string;
  name: string;
  description?: string;
  facts: unknown[];
};

export class FactSetLoadError extends Error {
  constructor(
    message: string,
    readonly factSetId: string,
    readonly issues: string[] = []
  ) {
    super(message);
    this.name = "FactSetLoadError";
  }
}

const FACT_DOMAINS: readonly FactDomain[] = [
  "UAS",
  "cyber",
  "maritime",
  "ground",
  "air",
  "space",
  "information",
  "logistics",
  "signals",
];

const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ["low", "medium", "high"];
const SEVERITY_LEVELS: readonly SeverityLevel[] = ["low", "medium", "high", "critical"];

const scenarioModules = import.meta.glob<ScenarioFactSetFile>("../scenarios/*.json", {
  eager: true,
  import: "default",
});

const registryById = buildRegistry(scenarioModules);

function buildRegistry(
  modules: Record<string, ScenarioFactSetFile>
): Map<string, ScenarioFactSetFile> {
  const byId = new Map<string, ScenarioFactSetFile>();

  for (const [path, file] of Object.entries(modules)) {
    const headerIssues = validateScenarioHeader(file, path);
    if (headerIssues.length > 0) {
      throw new FactSetLoadError(
        `Invalid scenario file ${path}`,
        file?.id ?? path,
        headerIssues
      );
    }

    if (byId.has(file.id)) {
      throw new FactSetLoadError(
        `Duplicate scenario id "${file.id}" (also defined in another file)`,
        file.id,
        [`path: ${path}`]
      );
    }

    byId.set(file.id, file);
  }

  return byId;
}

/**
 * Lists every scenario discovered under src/scenarios/.
 * Safe to call from UI or CLI without knowing file names.
 */
export function listAvailableFactSets(): FactSetDescriptor[] {
  return [...registryById.values()]
    .map((file) => ({
      id: file.id,
      name: file.name,
      description: file.description,
      factCount: file.facts.length,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Loads and validates a scenario's facts by id (e.g. "port-a").
 */
export function loadFactSet(id: string): ObservedFact[] {
  const file = registryById.get(id);
  if (!file) {
    const available = listAvailableFactSets()
      .map((d) => d.id)
      .join(", ");
    throw new FactSetLoadError(
      `Unknown fact set "${id}". Available: ${available || "(none)"}`,
      id
    );
  }

  return validateObservedFacts(file.facts, id);
}

/** @deprecated Prefer loadFactSet(DEFAULT_FACT_SET_ID). Kept for existing call sites. */
export function stubPortAFacts(): ObservedFact[] {
  return loadFactSet(DEFAULT_FACT_SET_ID);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateObservedFact(value: unknown, path = "fact"): string[] {
  const issues: string[] = [];

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [`${path}: expected object`];
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || record.id.trim() === "") {
    issues.push(`${path}.id: required non-empty string`);
  }

  if (!isFactDomain(record.domain)) {
    issues.push(`${path}.domain: invalid FactDomain`);
  }

  if (typeof record.entity !== "string" || record.entity.trim() === "") {
    issues.push(`${path}.entity: required non-empty string`);
  }

  if (typeof record.event !== "string" || record.event.trim() === "") {
    issues.push(`${path}.event: required non-empty string`);
  }

  if (typeof record.time !== "string" || record.time.trim() === "") {
    issues.push(`${path}.time: required non-empty string`);
  }

  if (record.location !== undefined && typeof record.location !== "string") {
    issues.push(`${path}.location: must be string when present`);
  }

  if (record.coordinates !== undefined) {
    issues.push(...validateCoordinates(record.coordinates, `${path}.coordinates`));
  }

  if (typeof record.source !== "string" || record.source.trim() === "") {
    issues.push(`${path}.source: required non-empty string`);
  }

  if (!isConfidenceLevel(record.confidence)) {
    issues.push(`${path}.confidence: invalid ConfidenceLevel`);
  }

  if (!isSeverityLevel(record.severity)) {
    issues.push(`${path}.severity: invalid SeverityLevel`);
  }

  if (record.rawEvidenceRef !== undefined && typeof record.rawEvidenceRef !== "string") {
    issues.push(`${path}.rawEvidenceRef: must be string when present`);
  }

  return issues;
}

export function validateObservedFacts(facts: unknown[], factSetId: string): ObservedFact[] {
  if (!Array.isArray(facts)) {
    throw new FactSetLoadError(
      `Fact set "${factSetId}" facts must be an array`,
      factSetId,
      ["facts: expected array"]
    );
  }

  const issues: string[] = [];
  const validated: ObservedFact[] = [];

  facts.forEach((item, index) => {
    const path = `facts[${index}]`;
    const itemIssues = validateObservedFact(item, path);
    if (itemIssues.length > 0) {
      issues.push(...itemIssues);
      return;
    }
    validated.push(item as ObservedFact);
  });

  if (issues.length > 0) {
    throw new FactSetLoadError(
      `Fact set "${factSetId}" failed validation`,
      factSetId,
      issues
    );
  }

  return validated;
}

function validateScenarioHeader(
  file: ScenarioFactSetFile | undefined,
  path: string
): string[] {
  if (!file || typeof file !== "object") {
    return [`${path}: expected JSON object`];
  }

  const issues: string[] = [];

  if (typeof file.id !== "string" || file.id.trim() === "") {
    issues.push("id: required non-empty string");
  }

  if (typeof file.name !== "string" || file.name.trim() === "") {
    issues.push("name: required non-empty string");
  }

  if (file.description !== undefined && typeof file.description !== "string") {
    issues.push("description: must be string when present");
  }

  if (!Array.isArray(file.facts)) {
    issues.push("facts: required array");
  }

  return issues;
}

function validateCoordinates(value: unknown, path: string): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [`${path}: expected object`];
  }

  const coords = value as Record<string, unknown>;
  const issues: string[] = [];

  if (typeof coords.lat !== "number" || !Number.isFinite(coords.lat)) {
    issues.push(`${path}.lat: required finite number`);
  }

  if (typeof coords.lng !== "number" || !Number.isFinite(coords.lng)) {
    issues.push(`${path}.lng: required finite number`);
  }

  return issues;
}

function isFactDomain(value: unknown): value is FactDomain {
  return typeof value === "string" && (FACT_DOMAINS as readonly string[]).includes(value);
}

function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return (
    typeof value === "string" && (CONFIDENCE_LEVELS as readonly string[]).includes(value)
  );
}

function isSeverityLevel(value: unknown): value is SeverityLevel {
  return typeof value === "string" && (SEVERITY_LEVELS as readonly string[]).includes(value);
}
