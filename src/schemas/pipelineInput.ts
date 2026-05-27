import { z } from "zod";

const intelActionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  citedFacts: z.array(z.string()).min(1),
  actionType: z
    .enum([
      "observe",
      "monitor",
      "investigate",
      "coordinate",
      "preserve",
      "inform",
      "harden",
      "other",
    ])
    .optional(),
  requiredAssets: z.array(z.string()).optional(),
  timeSensitivity: z.enum(["immediate", "time-bound", "routine"]).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export const pipelineInputSchema = z.object({
  mode: z.enum(["validated-intel", "demo"]),
  signals: z.array(z.unknown()).optional(),
  scenarioId: z.string().optional(),
  scenarioVersion: z.string().optional(),
  observedFacts: z.array(z.unknown()).optional(),
  intelActions: z.array(intelActionSchema).optional(),
});
