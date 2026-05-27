/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ollama | openai | stub */
  readonly VITE_LLM_PROVIDER?: string;
  readonly VITE_OLLAMA_BASE_URL?: string;
  readonly VITE_LLM_MODEL?: string;
  readonly VITE_LLM_ENDPOINT?: string;
  readonly VITE_LLM_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
