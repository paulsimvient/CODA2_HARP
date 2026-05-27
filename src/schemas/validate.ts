import type { LLMInterpretation } from "../intel/types";
import type { PipelineInput } from "../coa/types";
import { llmInterpretationSchema } from "./llmInterpretation";
import { pipelineInputSchema } from "./pipelineInput";

export class SchemaValidationError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

/**
 * Runtime boundary: parsed LLM JSON must match the strict interpreter contract.
 */
export function assertLLMInterpretationSchema(
  interpretation: LLMInterpretation
): LLMInterpretation {
  const result = llmInterpretationSchema.safeParse(interpretation);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new SchemaValidationError(
      `LLM interpretation failed schema validation (${issues.length} issue(s))`,
      issues
    );
  }
  return result.data as LLMInterpretation;
}

/**
 * Runtime boundary: pipeline input before solver/effects.
 */
export function assertPipelineInputSchema(input: PipelineInput): PipelineInput {
  const result = pipelineInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new SchemaValidationError(
      `Pipeline input failed schema validation (${issues.length} issue(s))`,
      issues
    );
  }
  return input;
}
