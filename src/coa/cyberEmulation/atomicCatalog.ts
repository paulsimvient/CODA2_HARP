import { isAllowlistedTechnique } from "./allowlist";

/**
 * Allowlisted Atomic Red Team–style validation tests (defensive lab scope only).
 * IDs follow ART-style naming; execution is via the lab harness, not in-app exploits.
 */
export type AtomicLabTest = {
  testId: string;
  name: string;
  techniqueId: string;
  description: string;
  expectedControlIds: string[];
};

export const ATOMIC_LAB_CATALOG: readonly AtomicLabTest[] = [
  {
    testId: "T1110.001-brute-force-password-guessing",
    name: "Brute Force: Password Guessing",
    techniqueId: "T1110",
    description: "Validate SIEM/IdP detects repeated failed authentication patterns.",
    expectedControlIds: ["siem-auth-anomaly"],
  },
  {
    testId: "T1078.004-valid-accounts-cloud",
    name: "Valid Accounts: Cloud Accounts",
    techniqueId: "T1078",
    description: "Validate cloud IAM anomaly rules for suspicious session activity.",
    expectedControlIds: ["siem-auth-anomaly"],
  },
  {
    testId: "T1057-process-discovery",
    name: "Process Discovery",
    techniqueId: "T1057",
    description: "Validate EDR detects scripted process enumeration chains.",
    expectedControlIds: ["edr-process-discovery"],
  },
  {
    testId: "T1082-system-info-discovery",
    name: "System Information Discovery",
    techniqueId: "T1082",
    description: "Validate EDR baseline for host inventory commands.",
    expectedControlIds: ["edr-process-discovery"],
  },
  {
    testId: "T1046-network-service-discovery",
    name: "Network Service Discovery",
    techniqueId: "T1046",
    description: "Validate NDR for internal port scan heuristics.",
    expectedControlIds: ["ndr-lateral-beacon"],
  },
  {
    testId: "T1040-network-sniffing",
    name: "Network Sniffing",
    techniqueId: "T1040",
    description: "Validate NDR for passive capture indicators in lab VLAN.",
    expectedControlIds: ["ndr-lateral-beacon"],
  },
  {
    testId: "T1071.001-application-layer-protocol-web",
    name: "Application Layer Protocol: Web Protocols",
    techniqueId: "T1071",
    description: "Validate proxy/NDR C2 beacon heuristics on lab egress.",
    expectedControlIds: ["ndr-lateral-beacon"],
  },
] as const;

const MAX_TESTS_PER_RUN = 4;

export function selectAtomicTestsForTechniques(techniqueIds: string[]): AtomicLabTest[] {
  const uniqueTechniques = [...new Set(techniqueIds.filter(isAllowlistedTechnique))];
  const selected: AtomicLabTest[] = [];

  for (const techniqueId of uniqueTechniques) {
    for (const test of ATOMIC_LAB_CATALOG) {
      if (test.techniqueId !== techniqueId) continue;
      if (selected.some((s) => s.testId === test.testId)) continue;
      selected.push(test);
      if (selected.length >= MAX_TESTS_PER_RUN) return selected;
    }
  }

  return selected;
}
