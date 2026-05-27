import type { AttckTechniqueRef } from "./types";

/**
 * Defensive / assessment-oriented ATT&CK techniques permitted in lab emulation.
 * Offensive exploitation chains are intentionally excluded.
 */
export const ALLOWLISTED_TECHNIQUES: readonly AttckTechniqueRef[] = [
  {
    techniqueId: "T1078",
    techniqueName: "Valid Accounts",
    tactic: "Persistence",
  },
  {
    techniqueId: "T1110",
    techniqueName: "Brute Force",
    tactic: "Credential Access",
  },
  {
    techniqueId: "T1040",
    techniqueName: "Network Sniffing",
    tactic: "Credential Access",
  },
  {
    techniqueId: "T1057",
    techniqueName: "Process Discovery",
    tactic: "Discovery",
  },
  {
    techniqueId: "T1082",
    techniqueName: "System Information Discovery",
    tactic: "Discovery",
  },
  {
    techniqueId: "T1046",
    techniqueName: "Network Service Discovery",
    tactic: "Discovery",
  },
  {
    techniqueId: "T1562.001",
    techniqueName: "Disable or Modify Tools",
    tactic: "Defense Evasion",
  },
  {
    techniqueId: "T1071",
    techniqueName: "Application Layer Protocol",
    tactic: "Command and Control",
  },
] as const;

const allowlistIds = new Set(ALLOWLISTED_TECHNIQUES.map((t) => t.techniqueId));

export function isAllowlistedTechnique(techniqueId: string): boolean {
  return allowlistIds.has(techniqueId);
}

export function assertAllowlistedTechniques(techniqueIds: string[]): void {
  for (const id of techniqueIds) {
    if (!isAllowlistedTechnique(id)) {
      throw new Error(
        `[cyber-emulation] Technique ${id} is not on the lab allowlist.`
      );
    }
  }
}
