import type { LogisticsPlan } from "./types";

/** Stable empty plan — selectors must not allocate new objects per subscription tick. */
export const EMPTY_DISPLAYED_PLAN = {
  kind: "empty",
  reason: "no-coa-selected",
} as const satisfies LogisticsPlan | { kind: "empty"; reason: "no-coa-selected" };

export const EMPTY_LOGISTICS_NOT_BUILT = {
  kind: "empty",
  reason: "not-built",
} as const satisfies LogisticsPlan | { kind: "empty"; reason: "not-built" };
