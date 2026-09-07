export type ModelProvider = "openai" | "deepseek" | "qwen" | "custom";

export interface ModelProfile {
  id: string;
  name: string;
  provider: ModelProvider;
  baseUrl: string;
  model: string;
  rememberApiKey: boolean;
  consentedOrigin?: string;
  consentedAt?: string;
}

export interface AiSettings {
  schemaVersion: 1;
  onboardingCompleted: boolean;
  activeProfileId: string | null;
  profiles: ModelProfile[];
}

export interface HunkSuggestion {
  hunkId: string;
  explanation: string;
  replacementText?: string;
  recommendedTarget?: "left" | "right";
}

export interface AiAnalysisResult {
  summary: string;
  risks: string[];
  suggestions: HunkSuggestion[];
}

export interface ModelConnectionResult {
  elapsedMs: number;
  model: string;
  origin: string;
}
