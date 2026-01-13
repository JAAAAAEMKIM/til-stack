import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "til-ai-config";

const DEFAULT_WEEKLY_PROMPT = `These are daily TIL (Today I Learned) entries from a developer's learning journal.
Summarize the key technical learnings and insights from this week in 3-5 bullet points.
Focus on: new concepts learned, problems solved, and skills practiced.`;

export type AIBackend = "gemini-nano" | "webllm" | "groq" | "google-ai";

export const AI_BACKENDS: {
  id: AIBackend;
  name: string;
  description: string;
  disabled?: boolean;
  requiresApiKey?: boolean;
}[] = [
  {
    id: "gemini-nano",
    name: "Gemini Nano",
    description: "Chrome built-in AI (requires Chrome 138+)",
  },
  {
    id: "webllm",
    name: "WebLLM",
    description: "Local LLM via WebGPU",
  },
  {
    id: "groq",
    name: "Groq Cloud",
    description: "Llama 3.3 70B - Fast & Free tier available",
    requiresApiKey: true,
  },
  {
    id: "google-ai",
    name: "Google AI",
    description: "Gemini 2.0 Flash - Fast & Free tier available",
    requiresApiKey: true,
  },
];

// WebLLM model options - sorted by quality/size
export const WEBLLM_MODELS: {
  id: string;
  name: string;
  description: string;
  vramMB: number;
}[] = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Qwen2.5-1.5B (Recommended)",
    description: "Best multilingual support including Korean (~1GB)",
    vramMB: 1000,
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    name: "Qwen2.5-3B",
    description: "Better quality, larger size (~2GB)",
    vramMB: 2000,
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    name: "Llama-3.2-3B",
    description: "Good multilingual, Meta's latest (~2GB)",
    vramMB: 2000,
  },
];

export interface AIConfig {
  enabled: boolean;
  backend: AIBackend;
  weeklyPrompt: string;
  webllmModel: string;
  groqApiKey: string;
  googleAiApiKey: string;
}

const DEFAULT_CONFIG: AIConfig = {
  enabled: true,
  backend: "gemini-nano",
  weeklyPrompt: DEFAULT_WEEKLY_PROMPT,
  webllmModel: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  groqApiKey: "",
  googleAiApiKey: "",
};

function loadConfig(): AIConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const config = { ...DEFAULT_CONFIG, ...parsed };
      console.log("[AIConfig] Loaded from localStorage:", {
        backend: config.backend,
        enabled: config.enabled,
        hasGoogleAiKey: !!config.googleAiApiKey,
        googleAiKeyPreview: config.googleAiApiKey ? `${config.googleAiApiKey.slice(0, 8)}...` : "(empty)",
      });
      return config;
    }
  } catch {
    // Ignore parse errors
  }
  console.log("[AIConfig] Using default config (no stored config found)");
  return DEFAULT_CONFIG;
}

function saveConfig(config: AIConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function useAIConfig() {
  const [config, setConfigState] = useState<AIConfig>(DEFAULT_CONFIG);
  const [isSupported, setIsSupported] = useState(false);

  console.log("[AIConfig] useAIConfig render, current config:", {
    backend: config.backend,
    hasGoogleAiKey: !!config.googleAiApiKey,
  });

  // Load config on mount
  useEffect(() => {
    console.log("[AIConfig] useEffect - loading config from localStorage");
    const loaded = loadConfig();
    console.log("[AIConfig] useEffect - setting config state:", {
      backend: loaded.backend,
      hasGoogleAiKey: !!loaded.googleAiApiKey,
    });
    setConfigState(loaded);
    setIsSupported("Summarizer" in window);
  }, []);

  const setConfig = useCallback((updates: Partial<AIConfig>) => {
    setConfigState((prev) => {
      const newConfig = { ...prev, ...updates };
      saveConfig(newConfig);
      return newConfig;
    });
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setConfig({ enabled });
  }, [setConfig]);

  const setWeeklyPrompt = useCallback((weeklyPrompt: string) => {
    setConfig({ weeklyPrompt });
  }, [setConfig]);

  const setBackend = useCallback((backend: AIBackend) => {
    setConfig({ backend });
  }, [setConfig]);

  const setWebllmModel = useCallback((webllmModel: string) => {
    setConfig({ webllmModel });
  }, [setConfig]);

  const setGroqApiKey = useCallback((groqApiKey: string) => {
    setConfig({ groqApiKey });
  }, [setConfig]);

  const setGoogleAiApiKey = useCallback((googleAiApiKey: string) => {
    setConfig({ googleAiApiKey });
  }, [setConfig]);

  const resetPrompt = useCallback(() => {
    setConfig({ weeklyPrompt: DEFAULT_WEEKLY_PROMPT });
  }, [setConfig]);

  return {
    config,
    isSupported,
    setEnabled,
    setBackend,
    setWebllmModel,
    setGroqApiKey,
    setGoogleAiApiKey,
    setWeeklyPrompt,
    resetPrompt,
    DEFAULT_WEEKLY_PROMPT,
  };
}
