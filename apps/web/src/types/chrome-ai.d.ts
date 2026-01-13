// Chrome Built-in AI - Summarizer API Type Declarations
// https://developer.chrome.com/docs/ai/summarizer-api

declare global {
  interface Window {
    Summarizer?: typeof Summarizer;
  }

  type SummarizerType = "key-points" | "tl;dr" | "teaser" | "headline";
  type SummarizerFormat = "markdown" | "plain-text";
  type SummarizerLength = "short" | "medium" | "long";

  type AIModelAvailability = "unavailable" | "downloadable" | "downloading" | "available";

  interface SummarizerCreateOptions {
    type?: SummarizerType;
    format?: SummarizerFormat;
    length?: SummarizerLength;
    sharedContext?: string;
    monitor?: (monitor: AICreateMonitor) => void;
  }

  interface AICreateMonitor {
    addEventListener(
      type: "downloadprogress",
      listener: (event: AIDownloadProgressEvent) => void
    ): void;
  }

  interface AIDownloadProgressEvent {
    loaded: number;
    total: number;
  }

  interface SummarizeOptions {
    context?: string;
  }

  class Summarizer {
    static availability(): Promise<AIModelAvailability>;
    static create(options?: SummarizerCreateOptions): Promise<Summarizer>;

    summarize(text: string, options?: SummarizeOptions): Promise<string>;
    summarizeStreaming(
      text: string,
      options?: SummarizeOptions
    ): ReadableStream<string>;

    destroy(): void;
  }
}

export {};
