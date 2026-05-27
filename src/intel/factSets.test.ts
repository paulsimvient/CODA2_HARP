import { describe, expect, it } from "vitest";
import {
  DEFAULT_FACT_SET_ID,
  listAvailableFactSets,
  loadFactSet,
  stubPortAFacts,
  validateObservedFact,
} from "./factSets";

describe("factSets", () => {
  it("discovers port-a scenario", () => {
    const sets = listAvailableFactSets();
    expect(sets.some((s) => s.id === "port-a")).toBe(true);
    const portA = sets.find((s) => s.id === "port-a");
    expect(portA?.factCount).toBe(11);
  });

  it("loads port-a facts with valid ObservedFact shape", () => {
    const facts = loadFactSet("port-a");
    expect(facts).toHaveLength(11);
    expect(facts.every((f) => validateObservedFact(f).length === 0)).toBe(true);
    expect(facts[0]?.id).toBe("fact_sig_001");
  });

  it("stubPortAFacts matches default fact set", () => {
    expect(stubPortAFacts()).toEqual(loadFactSet(DEFAULT_FACT_SET_ID));
  });

  it("throws for unknown scenario id", () => {
    expect(() => loadFactSet("does-not-exist")).toThrow(/Unknown fact set/);
  });
});
