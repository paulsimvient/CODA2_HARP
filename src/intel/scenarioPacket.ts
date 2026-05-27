import type { AuthorityState, ObservedFact, ScenarioPacket } from "./types";

// ─── Scenario packet builder ──────────────────────────────────────────────────
//
// Builds the bounded context given to the LLM.
//
// "Bounded" means:
//   - Only the facts you explicitly include are visible to the model.
//   - Commander intent and constraints scope the reasoning.
//   - The LLM cannot invent facts from outside this packet.

type BuildScenarioPacketInput = {
  commanderIntent: string;
  facts: ObservedFact[];
  knownAssets: string[];
  knownAuthorities?: Record<string, AuthorityState>;
  constraints?: string[];
  /** Optional free-text situational context (operational picture, NOTAMS, etc.) */
  contextWindow?: string;
};

/**
 * Constructs a ScenarioPacket from normalized facts.
 *
 * The packet applies the following filters before giving facts to the LLM:
 *   - Drops facts with confidence "low" unless overridden
 *   - Logs which facts were excluded (for audit)
 *
 * This is a deliberate design choice: the LLM should not speculate from
 * low-confidence inputs unless the operator explicitly opts in.
 * The grounding validator still checks against the full known fact set.
 */
export function buildScenarioPacket(
  input: BuildScenarioPacketInput,
  options: { includeLowConfidence?: boolean } = {}
): { packet: ScenarioPacket; excludedFacts: ObservedFact[] } {
  const {
    commanderIntent,
    facts,
    knownAssets,
    knownAuthorities,
    constraints = [],
    contextWindow,
  } = input;

  const included: ObservedFact[] = [];
  const excluded: ObservedFact[] = [];

  for (const fact of facts) {
    if (!options.includeLowConfidence && fact.confidence === "low") {
      excluded.push(fact);
    } else {
      included.push(fact);
    }
  }

  const packet: ScenarioPacket = {
    commanderIntent,
    observedFacts: included,
    knownAssets,
    ...(knownAuthorities ? { knownAuthorities } : {}),
    constraints: [
      // System-level constraints always applied
      "Do not create or invent observed facts. Facts are provided as input only.",
      "Every inference must cite at least one fact ID from observedFacts.",
      "Every candidate action must cite at least one fact ID from observedFacts.",
      "Do not use: proves, confirms, shows adversary did X. Use: may indicate, is consistent with, could suggest, requires confirmation.",
      "Do not assume attribution without explicit intelligence support.",
      // Caller-provided constraints
      ...constraints,
    ],
    ...(contextWindow ? { contextWindow } : {}),
  };

  return { packet, excludedFacts: excluded };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
//
// Converts a ScenarioPacket into a concrete LLM prompt string.
// Keeping this separate from the packet means you can change the prompt
// format without changing the data model.

export function buildInterpreterPrompt(packet: ScenarioPacket): string {
  const factList = packet.observedFacts
    .map(
      (f, i) =>
        `${i + 1}. [${f.id}] ${f.domain.toUpperCase()} | ${f.entity}: "${f.event}" ` +
        `at ${f.time} — source: ${f.source}, confidence: ${f.confidence}, severity: ${f.severity}.` +
        (f.location ? ` Location: ${f.location}.` : "")
    )
    .join("\n");

  const assetList = packet.knownAssets.map((a) => `- ${a}`).join("\n");
  const authorityList = Object.entries(packet.knownAuthorities ?? {})
    .map(([name, state]) => `- ${name}: ${state}`)
    .join("\n");
  const constraintList = packet.constraints.map((c) => `- ${c}`).join("\n");

  return `
You are an intelligence analyst supporting a command planning cell.

## Commander Intent
${packet.commanderIntent}

${packet.contextWindow ? `## Operational Context\n${packet.contextWindow}\n` : ""}
## Observed Facts
${factList}

## Available Assets
${assetList}

${authorityList ? `## Authority States\n${authorityList}\n` : ""}
## Constraints
${constraintList}

## Your Task
Analyze the observed facts above and return a JSON object with this exact structure:

{
  "observedFactsUsed": string[],          // IDs from the list above that informed your analysis
  "inferences": [
    {
      "claim": string,
      "supportingFacts": string[],         // fact IDs
      "confidence": "low" | "medium" | "high",
      "whyNotHigher": string | undefined   // required if confidence is not "high"
    }
  ],
  "decisionPoints": [
    {
      "id": string,
      "question": string,
      "triggerFacts": string[],
      "deadline": string | undefined,
      "commanderLevel": "watch-floor" | "section-lead" | "commander",
      "reversible": boolean,
      "informationNeeded": string[],
      "triggerCondition": string | undefined,
      "escalationThreshold": string | undefined,
      "deescalationThreshold": string | undefined,
      "abortCondition": string | undefined,
      "options": [
        {
          "id": string,
          "label": string,
          "actionType": "observe" | "monitor" | "investigate" | "coordinate" | "preserve" | "inform" | "harden" | "other",
          "benefits": string[],
          "risks": string[],
          "requiredAssets": string[],
          "requiredAuthority": string[],
          "secondOrderEffects": string[],
          "confidence": "low" | "medium" | "high",
          "citedFacts": string[]
        }
      ]
    }
  ],
  "assumptions": [
    {
      "claim": string,
      "status": "unconfirmed" | "working-assumption"
    }
  ],
  "uncertainties": string[],
  "candidateActions": [
    {
      "id": string,                        // e.g. "action_001"
      "description": string,
      "actionType": "observe" | "monitor" | "investigate" | "coordinate" | "preserve" | "inform" | "harden" | "other",
      "purpose": string,
      "citedFacts": string[],              // fact IDs that support this action
      "citedInferences": string[],         // inference claims that support it (by claim text)
      "requiredAssets": string[],
      "requiredAuthority": string[],
      "expectedEffects": string[],
      "timeSensitivity": "immediate" | "time-bound" | "routine",
      "recommendedOwner": string,
      "risks": string[],
      "conflicts": string[],
      "assumptions": string[],
      "confidence": "low" | "medium" | "high",
      "rationale": string                  // use hedge language only
    }
  ]
}

Rules:
- observedFactsUsed must include every fact ID that influenced your output.
- Every inference must cite at least one fact ID in supportingFacts.
- Every decisionPoint must cite at least one fact ID in triggerFacts.
- Every decision option must cite at least one fact ID in citedFacts.
- If an option cannot cite an observed fact, do not emit that option.
- Do not rely only on decisionPoint.triggerFacts; each option must be independently grounded.
- Every candidateAction must cite at least one fact ID in citedFacts.
- If Observed Facts is non-empty, do not return empty arrays.
- If facts are limited, provide monitoring/confirmation/information-gathering options instead of empty output.
- If Observed Facts is non-empty, produce at least 2 inferences, 2 decisionPoints, and 2 candidateActions.
- Every requiredAssets entry must be from Available Assets.
- If requiredAuthority is non-empty, each authority must be present in Authority States.
- Do not include fact IDs that do not appear in the Observed Facts section above.
- Do not invent entities, locations, or events.
- Use only allowed hedge language: "may indicate", "is consistent with", "could suggest", "requires confirmation".
- Return only the JSON object. No preamble, no explanation outside the JSON.
`.trim();
}
