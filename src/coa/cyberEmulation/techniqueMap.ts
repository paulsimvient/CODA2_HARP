import { ALLOWLISTED_TECHNIQUES } from "./allowlist";
import type { AttckTechniqueRef } from "./types";

/**
 * Maps validated cyber-relevant action text to allowlisted ATT&CK techniques.
 * Deterministic — no LLM involvement.
 */
export function mapActionsToTechniques(
  descriptions: string[],
  actionTypes: string[]
): AttckTechniqueRef[] {
  const blob = `${descriptions.join(" ")} ${actionTypes.join(" ")}`.toLowerCase();
  const selected = new Map<string, AttckTechniqueRef>();

  const add = (techniqueId: string) => {
    const ref = ALLOWLISTED_TECHNIQUES.find((t) => t.techniqueId === techniqueId);
    if (ref) selected.set(techniqueId, ref);
  };

  if (/auth|credential|login|brute|password|account/.test(blob)) {
    add("T1078");
    add("T1110");
  }
  if (/network|traffic|sniff|packet|siem|log/.test(blob)) {
    add("T1040");
    add("T1071");
  }
  if (/discover|inventory|scan|enumerate|baseline/.test(blob)) {
    add("T1057");
    add("T1082");
    add("T1046");
  }
  if (/harden|disable.*tool|edr|defense/.test(blob)) {
    add("T1562.001");
  }

  if (selected.size === 0 && actionTypes.some((t) => t === "cyber")) {
    add("T1078");
    add("T1057");
  }

  return Array.from(selected.values());
}
