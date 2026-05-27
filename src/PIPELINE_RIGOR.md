# Pipeline rigor — Intel, LLM, SMT, COA

**Short version for Sim:** Make the pipeline auditable. Every COA traces from fact IDs → validated actions → solver constraints → logistics/effects → matrix cells. The LLM proposes and explains; validation and the solver decide what is allowed.

## Trust boundary

```text
Raw reports
→ deterministic normalization (ObservedFact)
→ bounded scenario packet
→ LLM proposes interpretations / candidate actions
→ deterministic grounding validator
→ cited-only signals → SMT-style solver
→ logistics → effects → intel-fidelity → ranking
→ UI
```

**Rule:** Nothing becomes a COA unless it survives grounding and solver constraints.

**Rule:** LLM prose may explain a COA; it may not change COA structure, feasibility, score, or rank.

## Implementation map

| # | Requirement | Status | Location |
|---|-------------|--------|----------|
| 1 | Explicit trust boundary | Documented | This file, `COA_PIPELINE.md` |
| 2 | Evidence for every action | Enforced | `grounding.ts`, `filterCitedIntelActions()` |
| 3 | Hard vs soft constraints | Partial | Solver hard/soft traces; ranking uses soft scores only |
| 4 | Formal constraint traces | Implemented | `constraintTrace.ts`, `validatedIntelSolver.ts` |
| 5 | Confidence inflation blocked | Implemented | `evidence.ts`, `confidence-exceeds-evidence` issue |
| 6 | Contradiction handling | Implemented | `detectEvidenceConflicts()` |
| 7 | Typed schemas + Zod | Types only | `intel/types.ts`, `coa/types.ts` — Zod not yet added |
| 8 | Competing COA bundles | Implemented | `validatedIntelSolver.ts` (replaces single mega-bundle) |
| 9 | Dominance checks | Implemented | `dominance.ts` |
| 10 | Sensitivity analysis | Planned | Weight-flip analysis not yet in UI |
| 11 | Monotonic scoring tests | Partial | Add as scoring evolves |
| 12 | Invariant tests | Implemented | `assertions.ts`, vitest suites |
| 13 | Auditable matrix cells | Partial | `intelFidelity`, score bars; full `derivedFrom` TBD |
| 14 | Ranking provenance | Implemented | `RankingExplanation`, `buildCoaRankRationale()` |
| 15 | LLM downstream-only | Enforced by architecture | Interpreter → grounding → pipeline |
| 16 | Adversarial tests | Partial | `grounding.test.ts`, `evidence.test.ts` — expand |
| 17 | Run versioning | Implemented | `CoaRunMetadata` on `CoaState` |
| 18 | First-class “unknown” | Partial | `insufficient_evidence` type reserved |

## Hard vs soft (target contract)

**Hard (UNSAT):** unknown assets, missing/prohibited authority, asset time overlap, uncited actions, escalatory actions under evidence conflict.

**Soft (ranking):** logistics burden, effects, risk, intel alignment, parsimony.

## UI data rules

```ts
// Logistics — never a global trail
state.candidatesById[state.selectedCoaId].logisticsPlan

// UNSAT explanation
candidate.constraintTrace
formatConstraintTraces(candidate.constraintTrace)

// Rank audit
candidate.rankingExplanation
```

## Next increments

- Zod (or equivalent) at LLM parse boundary
- Sensitivity / ranking-stability panel
- `ScoredCell { value, derivedFrom[], explanation }` for Commander Matrix
- Expand adversarial fixture suite
- Real SMT backend replacing stub constraint evaluator
