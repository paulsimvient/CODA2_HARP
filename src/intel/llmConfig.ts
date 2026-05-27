export type LlmProvider = "ollama" | "openai" | "stub";

export type LlmConfig = {
  provider: LlmProvider;
  model: string;
  /** Ollama base URL, e.g. http://localhost:11434 */
  ollamaBaseUrl: string;
  /** Full URL for OpenAI-compatible chat completions */
  openaiEndpoint: string;
  apiKey: string;
};

const DEFAULT_OLLAMA_BASE = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";

export function getLlmConfig(): LlmConfig {
  const provider = resolveProvider();

  return {
    provider,
    model: (import.meta.env.VITE_LLM_MODEL as string | undefined) ?? DEFAULT_MODEL,
    ollamaBaseUrl:
      (import.meta.env.VITE_OLLAMA_BASE_URL as string | undefined) ??
      DEFAULT_OLLAMA_BASE,
    openaiEndpoint:
      (import.meta.env.VITE_LLM_ENDPOINT as string | undefined) ??
      `${DEFAULT_OLLAMA_BASE}/v1/chat/completions`,
    apiKey: (import.meta.env.VITE_LLM_API_KEY as string | undefined) ?? "ollama",
  };
}

export function usesLiveLlm(config: LlmConfig = getLlmConfig()): boolean {
  return config.provider !== "stub";
}

export function getLlmStatus(config: LlmConfig = getLlmConfig()): {
  label: string;
  mode: "live" | "stub";
} {
  if (!usesLiveLlm(config)) {
    return {
      label: "LLM stub",
      mode: "stub",
    };
  }

  return {
    label: `${config.provider}:${config.model}`,
    mode: "live",
  };
}

function resolveProvider(): LlmProvider {
  const explicit = import.meta.env.VITE_LLM_PROVIDER as string | undefined;

  if (explicit === "stub") return "stub";
  if (explicit === "openai") return "openai";
  if (explicit === "ollama") return "ollama";

  // Auto-detect: if an OpenAI endpoint is set without provider, use openai mode
  const endpoint = import.meta.env.VITE_LLM_ENDPOINT as string | undefined;
  if (endpoint && !endpoint.includes("11434")) return "openai";

  // Default to Ollama when .env sets VITE_OLLAMA_BASE_URL or typical ollama endpoint
  const ollamaBase = import.meta.env.VITE_OLLAMA_BASE_URL as string | undefined;
  if (ollamaBase || endpoint?.includes("11434")) return "ollama";

  // No LLM configuration — use stub
  if (!explicit && !endpoint && !ollamaBase) return "stub";

  return "ollama";
}
