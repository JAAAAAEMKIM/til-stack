// Unified Summarizer Hook
// Switches between Gemini Nano, WebLLM, Groq, and Google AI based on config

import { useCallback, useMemo } from "react";
import { useAIConfig, type AIBackend } from "./ai-config";
import {
  useGeminiSummarizer,
  type GeminiSummarizerStatus,
} from "./gemini-summarizer";
import { useWebLLMSummarizer, type WebLLMStatus } from "./webllm-summarizer";
import { useGroqSummarizer, type GroqStatus } from "./groq-summarizer";
import { useGoogleAISummarizer, type GoogleAIStatus } from "./google-ai-summarizer";

export type SummarizerStatus =
  | "unavailable"
  | "idle"
  | "loading"
  | "ready"
  | "generating";

// Map Gemini status to unified status
function mapGeminiStatus(status: GeminiSummarizerStatus): SummarizerStatus {
  switch (status) {
    case "unavailable":
      return "unavailable";
    case "downloadable":
      return "idle";
    case "downloading":
      return "loading";
    case "available":
      return "ready";
  }
}

// Map WebLLM status to unified status
function mapWebLLMStatus(status: WebLLMStatus): SummarizerStatus {
  return status;
}

// Map cloud status to unified status
function mapCloudStatus(status: GroqStatus | GoogleAIStatus, hasApiKey: boolean): SummarizerStatus {
  if (!hasApiKey) return "idle";
  if (status === "error") return "idle";
  return status;
}

export function useSummarizer() {
  const { config } = useAIConfig();

  const gemini = useGeminiSummarizer({
    sharedContext: config.weeklyPrompt,
  });

  const webllm = useWebLLMSummarizer(config.webllmModel, config.weeklyPrompt);

  const groq = useGroqSummarizer(config.groqApiKey, config.weeklyPrompt);

  const googleAi = useGoogleAISummarizer(config.googleAiApiKey, config.weeklyPrompt);

  const backend = config.backend;

  // Unified status
  const status: SummarizerStatus = useMemo(() => {
    if (backend === "gemini-nano") {
      return mapGeminiStatus(gemini.status);
    }
    if (backend === "webllm") {
      return mapWebLLMStatus(webllm.status);
    }
    if (backend === "groq") {
      return mapCloudStatus(groq.status, !!config.groqApiKey);
    }
    if (backend === "google-ai") {
      return mapCloudStatus(googleAi.status, !!config.googleAiApiKey);
    }
    return "unavailable";
  }, [backend, gemini.status, webllm.status, groq.status, googleAi.status, config.groqApiKey, config.googleAiApiKey]);

  // Unified progress
  const progress = useMemo(() => {
    if (backend === "gemini-nano") {
      return gemini.downloadProgress;
    }
    if (backend === "webllm") {
      return webllm.progress;
    }
    // Cloud backends don't have progress
    return 0;
  }, [backend, gemini.downloadProgress, webllm.progress]);

  // Progress text (WebLLM specific)
  const progressText = useMemo(() => {
    if (backend === "webllm") {
      return webllm.progressText;
    }
    return "";
  }, [backend, webllm.progressText]);

  // Initialize/download model
  const initDownload = useCallback(async () => {
    if (backend === "gemini-nano") {
      return gemini.initDownload();
    }
    if (backend === "webllm") {
      return webllm.loadModel();
    }
    // Cloud backends don't need initialization
  }, [backend, gemini.initDownload, webllm.loadModel]);

  // Streaming summarize
  const summarizeStream = useCallback(
    async function* (text: string): AsyncGenerator<string> {
      const userPrompt = config.weeklyPrompt;
      const combinedPrompt = `# Task Description\n\n${userPrompt}\n\n---\n\n# Scrum Contents\n\n${text}`;

      console.group("🤖 AI Summary Request");
      console.log("Backend:", backend);
      console.log("User Prompt:", userPrompt);
      console.log("Input Text:", text);
      console.log("--- Combined Prompt ---");
      console.log(combinedPrompt);
      console.groupEnd();

      if (backend === "gemini-nano") {
        yield* gemini.summarizeStream(text);
      } else if (backend === "webllm") {
        yield* webllm.summarizeStream(text);
      } else if (backend === "groq") {
        if (!config.groqApiKey) {
          throw new Error("Groq API key is required. Please add it in Settings.");
        }
        yield* groq.summarizeStream(text);
      } else if (backend === "google-ai") {
        if (!config.googleAiApiKey) {
          throw new Error("Google AI API key is required. Please add it in Settings.");
        }
        yield* googleAi.summarizeStream(text);
      } else {
        throw new Error(`Unsupported backend: ${backend}`);
      }
    },
    [backend, config.weeklyPrompt, config.groqApiKey, config.googleAiApiKey, gemini.summarizeStream, webllm.summarizeStream, groq.summarizeStream, googleAi.summarizeStream]
  );

  return {
    backend,
    status,
    progress,
    progressText,
    initDownload,
    summarizeStream,
  };
}

export type { AIBackend };
