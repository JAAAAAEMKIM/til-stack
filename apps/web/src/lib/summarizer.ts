// Unified Summarizer Hook
// Switches between Gemini Nano and WebLLM based on config

import { useCallback, useMemo } from "react";
import { useAIConfig, type AIBackend } from "./ai-config";
import {
  useGeminiSummarizer,
  type GeminiSummarizerStatus,
} from "./gemini-summarizer";
import { useWebLLMSummarizer, type WebLLMStatus } from "./webllm-summarizer";

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

export function useSummarizer() {
  const { config } = useAIConfig();

  const gemini = useGeminiSummarizer({
    sharedContext: config.weeklyPrompt,
  });

  const webllm = useWebLLMSummarizer(config.webllmModel, config.weeklyPrompt);

  const backend = config.backend;

  // Unified status
  const status: SummarizerStatus = useMemo(() => {
    if (backend === "gemini-nano") {
      return mapGeminiStatus(gemini.status);
    }
    if (backend === "webllm") {
      return mapWebLLMStatus(webllm.status);
    }
    return "unavailable";
  }, [backend, gemini.status, webllm.status]);

  // Unified progress
  const progress = useMemo(() => {
    if (backend === "gemini-nano") {
      return gemini.downloadProgress;
    }
    if (backend === "webllm") {
      return webllm.progress;
    }
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
  }, [backend, gemini.initDownload, webllm.loadModel]);

  // Streaming summarize
  const summarizeStream = useCallback(
    async function* (text: string): AsyncGenerator<string> {
      if (backend === "gemini-nano") {
        yield* gemini.summarizeStream(text);
      } else if (backend === "webllm") {
        yield* webllm.summarizeStream(text);
      } else {
        throw new Error(`Unsupported backend: ${backend}`);
      }
    },
    [backend, gemini.summarizeStream, webllm.summarizeStream]
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
