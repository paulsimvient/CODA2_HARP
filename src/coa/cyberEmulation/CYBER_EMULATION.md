# Cyber-effects adapter

Cyber emulation is a **cyber-effects adapter**, not an attack-execution feature. It makes cyber COA scoring more empirical, traceable, and repeatable.

## Pipeline position

```text
normalized facts → validated actions (cited) → SMT solver → cyber emulation adapter → effects scoring → intel fidelity → commander matrix
```

The LLM may propose cyber-relevant actions, but those actions must cite normalized facts, pass grounding validation, and satisfy SMT constraints before any emulation request is created. **There is no LLM-to-execution path.**

## Providers (phased)

| Provider | Phase | Role |
|----------|-------|------|
| `simulated` | 1 (default) | ATT&CK-mapped effects and residual-risk scoring |
| `atomic-red-team` | 2 (enabled) | Small allowlisted Atomic-style lab validation checks |
| `caldera` | 3 | Controlled campaign-level lab emulation (stub) |
| `manual-assessment` | — | Human red-team findings, no automated execution |

Each provider returns a `CyberEffectResult`: residual risk, confidence, techniques evaluated, expected/observed detections, explanation, and evidence refs.

## Hard requirements (enforced in code)

- Lab-only by default (`CYBER_EMULATION_CONFIG.labOnly`)
- Allowlisted ATT&CK techniques only (`allowlist.ts`)
- No direct production execution
- No exploit generation inside the app
- No LLM-to-execution path (adapter only called from `defaultEffectsEngine`)
- Human approval required before non-simulated runs
- Every run tied to `coaId`, validated action IDs, and cited fact IDs
- UI distinguishes **simulated** vs **lab-executed** results

## Phase 2 usage

1. Complete intel validation and a normal COA run (simulated cyber-effects).
2. On the **COA** view, open **Cyber lab validation (Phase 2)**.
3. Confirm lab environment and human approval, then **Re-score COAs with lab validation**.
4. Results show **LAB EXECUTED** with per-test detection lines (`atomic:…` evidence refs).

Optional: set `VITE_CYBER_LAB_HARNESS_URL` to POST validated test IDs to an external lab executor; the app falls back to the in-process executor if unreachable.

## Enabling Phase 3

1. Implement `caldera` under `providers/`.
2. Add `"caldera"` to `CYBER_EMULATION_CONFIG.enabledProviders`.
3. Require `humanApproved` and `labEnvironmentConfirmed` on the adapter request.
4. Never call providers from intel/LLM modules.
