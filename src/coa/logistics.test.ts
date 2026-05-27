import { describe, expect, it } from "vitest";
import { runCoaPipeline } from "./pipeline";

describe("validated-intel logistics plan safety", () => {
  it("does not include demo offensive labels in validated-intel logistics plan", async () => {
    const state = await runCoaPipeline({
      mode: "validated-intel",
      intelActions: [
        {
          id: "action_001",
          description: "Monitor UAS activity closely",
          actionType: "observe",
          requiredAssets: ["counter-uas-unit"],
          citedFacts: ["fact_uas_001"],
          confidence: "medium",
          timeSensitivity: "immediate",
        },
      ],
    });

    const selectedId = state.selectedCoaId;
    expect(selectedId).toBeDefined();
    const selected = selectedId ? state.candidatesById[selectedId] : undefined;
    expect(selected?.logisticsPlan.kind).toBe("populated");
    if (!selected || selected.logisticsPlan.kind !== "populated") return;

    const text = JSON.stringify(selected.logisticsPlan).toLowerCase();
    expect(text).not.toContain("cyber strike");
    expect(text).not.toContain("maritime blockade");
    expect(text).not.toContain("precision strike");
    expect(text).not.toContain("air superiority");
    expect(selected.logisticsPlan.source).toBe("validated-intel");
  });

  it("supports explicit demo mode separately from validated-intel mode", async () => {
    const state = await runCoaPipeline({
      mode: "demo",
      intelActions: [
        {
          id: "action_001",
          description: "Monitor UAS activity closely",
          actionType: "observe",
          requiredAssets: ["counter-uas-unit"],
          citedFacts: ["fact_uas_001"],
          confidence: "medium",
          timeSensitivity: "immediate",
        },
      ],
    });

    const selectedId = state.selectedCoaId;
    expect(selectedId).toBeDefined();
    const selected = selectedId ? state.candidatesById[selectedId] : undefined;
    expect(selected?.logisticsPlan.kind).toBe("populated");
    if (!selected || selected.logisticsPlan.kind !== "populated") return;
    expect(selected.logisticsPlan.source).toBe("demo");
  });
});
