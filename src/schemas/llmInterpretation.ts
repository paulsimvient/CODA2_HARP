import { z } from "zod";

const confidenceSchema = z.enum(["low", "medium", "high"]);
const actionTypeSchema = z.enum([
  "observe",
  "monitor",
  "investigate",
  "coordinate",
  "preserve",
  "inform",
  "harden",
  "other",
]);
const timeSensitivitySchema = z.enum(["immediate", "time-bound", "routine"]);
const commanderLevelSchema = z.enum(["watch-floor", "section-lead", "commander"]);

export const llmInterpretationSchema = z.object({
  observedFactsUsed: z.array(z.string()),
  inferences: z.array(
    z.object({
      claim: z.string(),
      supportingFacts: z.array(z.string()),
      confidence: confidenceSchema,
      whyNotHigher: z.string().optional(),
    })
  ),
  decisionPoints: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      triggerFacts: z.array(z.string()),
      options: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          actionType: actionTypeSchema,
          benefits: z.array(z.string()),
          risks: z.array(z.string()),
          requiredAssets: z.array(z.string()),
          requiredAuthority: z.array(z.string()),
          secondOrderEffects: z.array(z.string()),
          confidence: confidenceSchema,
          citedFacts: z.array(z.string()),
          grounding: z.enum(["explicit", "inherited"]).optional(),
          citedFactsInherited: z.boolean().optional(),
        })
      ),
      commanderLevel: commanderLevelSchema,
      reversible: z.boolean(),
      informationNeeded: z.array(z.string()),
      deadline: z.string().optional(),
      triggerCondition: z.string().optional(),
      escalationThreshold: z.string().optional(),
      deescalationThreshold: z.string().optional(),
      abortCondition: z.string().optional(),
    })
  ),
  assumptions: z.array(
    z.object({
      claim: z.string(),
      status: z.enum(["unconfirmed", "working-assumption"]),
    })
  ),
  uncertainties: z.array(z.string()),
  candidateActions: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      actionType: actionTypeSchema.optional(),
      purpose: z.string().optional(),
      citedFacts: z.array(z.string()),
      citedInferences: z.array(z.string()),
      requiredAssets: z.array(z.string()),
      requiredAuthority: z.array(z.string()),
      expectedEffects: z.array(z.string()).optional(),
      timeSensitivity: timeSensitivitySchema.optional(),
      recommendedOwner: z.string().optional(),
      risks: z.array(z.string()).optional(),
      conflicts: z.array(z.string()).optional(),
      assumptions: z.array(z.string()).optional(),
      confidence: confidenceSchema.optional(),
      rationale: z.string(),
    })
  ),
});

export type ParsedLLMInterpretation = z.infer<typeof llmInterpretationSchema>;
