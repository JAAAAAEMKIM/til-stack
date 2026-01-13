import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useSummarizer } from "@/lib/summarizer";
import { useAIConfig } from "@/lib/ai-config";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type SummaryState = "idle" | "generating" | "complete" | "error";

interface AISummaryProps {
  entries: Array<{ date: string; content: string }>;
  context: string; // e.g., "Week of Jan 6-12"
  autoStart?: boolean;
}

export function AISummary({ entries, context, autoStart = false }: AISummaryProps) {
  const { config } = useAIConfig();
  const { status: summarizerStatus, progress, summarizeStream, initDownload } =
    useSummarizer();

  const [state, setState] = useState<SummaryState>("idle");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hasStartedRef = useRef(false);
  const abortRef = useRef(false);

  // Generate summary from entries
  const generateSummary = useCallback(async () => {
    if (entries.length === 0) {
      setError("No entries to summarize");
      setState("error");
      return;
    }

    setState("generating");
    setSummary("");
    setError(null);
    abortRef.current = false;

    const inputText = entries
      .map((e) => `## ${e.date}\n${e.content}`)
      .join("\n\n");

    // Debug: Log entries being summarized
    console.group("📝 AI Summary Input");
    console.log("Entries count:", entries.length);
    console.log("Entries:", entries.map(e => ({ date: e.date, contentLength: e.content.length })));
    console.log("Generated input text:", inputText);
    console.groupEnd();

    try {
      const generator = summarizeStream(inputText);
      let fullText = "";

      for await (const chunk of generator) {
        if (abortRef.current) break;
        fullText += chunk; // Accumulate chunks
        setSummary(fullText);
      }

      if (!abortRef.current) {
        setState("complete");
      }
    } catch (err) {
      if (!abortRef.current) {
        setError(err instanceof Error ? err.message : "Failed to generate summary");
        setState("error");
      }
    }
  }, [entries, summarizeStream]);

  // Auto-start when enabled and ready
  useEffect(() => {
    if (
      autoStart &&
      !hasStartedRef.current &&
      config.enabled &&
      summarizerStatus === "ready" &&
      entries.length > 0
    ) {
      hasStartedRef.current = true;
      generateSummary();
    }
  }, [autoStart, config.enabled, summarizerStatus, entries.length, generateSummary]);

  // Reset hasStartedRef when entries change
  useEffect(() => {
    hasStartedRef.current = false;
  }, [entries]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  // Auto-load model when idle
  useEffect(() => {
    if (summarizerStatus === "idle" && config.enabled) {
      initDownload();
    }
  }, [summarizerStatus, config.enabled, initDownload]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetry = () => {
    hasStartedRef.current = false;
    generateSummary();
  };

  // Don't render if AI is disabled
  if (!config.enabled) {
    return null;
  }

  // Handle different summarizer states
  if (summarizerStatus === "unavailable") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <AlertCircle className="h-4 w-4" />
        <span>AI summarization not available in this browser</span>
      </div>
    );
  }

  if (summarizerStatus === "idle") {
    return (
      <div className="flex items-center gap-3 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm">Preparing AI model...</span>
      </div>
    );
  }

  if (summarizerStatus === "loading") {
    return (
      <div className="flex items-center gap-3 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm">
          Loading AI model... {Math.round(progress * 100)}%
        </span>
      </div>
    );
  }

  // No entries to summarize
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="border-b pb-3 mb-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI Summary</span>
          {state === "generating" && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {(state === "complete" || state === "error") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleRetry}
              title="Regenerate"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
          {state === "complete" && summary && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleCopy}
              title="Copy summary"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {state === "idle" && autoStart && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Preparing summary...</span>
        </div>
      )}

      {state === "error" && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {(state === "generating" || state === "complete") && summary && (
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-sm prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
        </div>
      )}

      {state === "generating" && !summary && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="animate-pulse">Generating summary...</span>
        </div>
      )}
    </div>
  );
}
