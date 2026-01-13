import { useState, useEffect, useCallback, useRef } from "react";

export type GeminiSummarizerStatus =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

interface UseGeminiSummarizerOptions {
  sharedContext?: string;
}

export function useGeminiSummarizer(options: UseGeminiSummarizerOptions = {}) {
  const [status, setStatus] = useState<GeminiSummarizerStatus>("unavailable");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const summarizerRef = useRef<Summarizer | null>(null);
  const lastContextRef = useRef<string | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Check availability on mount
  useEffect(() => {
    async function checkAvailability() {
      if (!("Summarizer" in window)) {
        setStatus("unavailable");
        return;
      }

      try {
        const availability = await Summarizer.availability();
        setStatus(availability);
      } catch {
        setStatus("unavailable");
      }
    }

    checkAvailability();
  }, []);

  // Invalidate summarizer when sharedContext changes
  useEffect(() => {
    if (lastContextRef.current !== undefined &&
        lastContextRef.current !== options.sharedContext &&
        summarizerRef.current) {
      summarizerRef.current.destroy();
      summarizerRef.current = null;
    }
    lastContextRef.current = options.sharedContext;
  }, [options.sharedContext]);

  // Initialize summarizer
  const initSummarizer = useCallback(async () => {
    if (!("Summarizer" in window)) {
      throw new Error("Summarizer API not available");
    }

    // If already have a summarizer, destroy and recreate with new context
    if (summarizerRef.current) {
      summarizerRef.current.destroy();
      summarizerRef.current = null;
    }

    try {
      setStatus("downloading");
      setDownloadProgress(0);

      const summarizer = await Summarizer.create({
        type: "key-points",
        format: "markdown",
        length: "medium",
        sharedContext: optionsRef.current.sharedContext,
        monitor: (monitor) => {
          monitor.addEventListener("downloadprogress", (event) => {
            const progress = event.total > 0 ? event.loaded / event.total : 0;
            setDownloadProgress(progress);
          });
        },
      });

      summarizerRef.current = summarizer;
      setStatus("available");
      setDownloadProgress(1);

      return summarizer;
    } catch (error) {
      setStatus("unavailable");
      throw error;
    }
  }, []);

  // Summarize with streaming
  const summarizeStream = useCallback(
    async function* (text: string): AsyncGenerator<string> {
      let summarizer = summarizerRef.current;

      // Initialize if needed
      if (!summarizer) {
        summarizer = await initSummarizer();
      }

      if (!summarizer) {
        throw new Error("Failed to initialize summarizer");
      }

      const stream = summarizer.summarizeStreaming(text);
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
    [initSummarizer]
  );

  // Non-streaming summarize
  const summarize = useCallback(
    async (text: string): Promise<string> => {
      let summarizer = summarizerRef.current;

      if (!summarizer) {
        summarizer = await initSummarizer();
      }

      if (!summarizer) {
        throw new Error("Failed to initialize summarizer");
      }

      return summarizer.summarize(text);
    },
    [initSummarizer]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (summarizerRef.current) {
        summarizerRef.current.destroy();
        summarizerRef.current = null;
      }
    };
  }, []);

  return {
    status,
    downloadProgress,
    summarize,
    summarizeStream,
    initDownload: initSummarizer,
  };
}
