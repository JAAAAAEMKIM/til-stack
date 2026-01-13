import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatCompletionMessageParam } from "@mlc-ai/web-llm";

export type WebLLMStatus =
  | "unavailable"
  | "idle"
  | "loading"
  | "ready"
  | "generating";

interface WorkerResponse {
  id: string;
  type: "progress" | "chunk" | "complete" | "error" | "status";
  payload?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onChunk?: (chunk: string) => void;
  onProgress?: (progress: number, text: string) => void;
}

let sharedWorker: SharedWorker | null = null;
let regularWorker: Worker | null = null;
const pendingRequests = new Map<string, PendingRequest>();
const progressListeners = new Set<(progress: number, text: string) => void>();

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function getWorkerPort(): MessagePort | Worker | null {
  if (sharedWorker) {
    return sharedWorker.port;
  }
  return regularWorker;
}

function initWorker() {
  if (sharedWorker || regularWorker) return;

  // Check for SharedWorker support
  if (typeof SharedWorker !== "undefined") {
    try {
      sharedWorker = new SharedWorker(
        new URL("./webllm-worker.ts", import.meta.url),
        { type: "module", name: "webllm-shared" }
      );

      sharedWorker.port.onmessage = handleMessage;
      sharedWorker.port.start();
      return;
    } catch (e) {
      console.warn("SharedWorker failed, falling back to Worker:", e);
    }
  }

  // Fallback to regular Worker
  regularWorker = new Worker(
    new URL("./webllm-worker.ts", import.meta.url),
    { type: "module" }
  );
  regularWorker.onmessage = handleMessage;
}

// Track if we're waiting for an init completion
const pendingInitRequests = new Set<string>();

function handleMessage(event: MessageEvent<WorkerResponse>) {
  const { id, type, payload } = event.data;
  const pending = pendingRequests.get(id);

  if (type === "progress") {
    const { progress, text, alreadyLoading } = payload as {
      progress: number;
      text: string;
      alreadyLoading?: boolean;
    };

    // Notify all progress listeners
    progressListeners.forEach((listener) => listener(progress, text));
    pending?.onProgress?.(progress, text);

    // If this is a response to an init request when already loading,
    // register this request to be resolved when loading completes
    if (alreadyLoading && pending) {
      pendingInitRequests.add(id);
    }
    return;
  }

  if (type === "chunk") {
    pending?.onChunk?.(payload as string);
    return;
  }

  if (type === "complete") {
    // Resolve the original request
    pending?.resolve(payload);
    pendingRequests.delete(id);

    // Also resolve any pending init requests that were waiting for loading to complete
    const completePayload = payload as { status?: string };
    if (completePayload?.status === "loaded" || completePayload?.status === "already_loaded") {
      pendingInitRequests.forEach((waitingId) => {
        const waitingPending = pendingRequests.get(waitingId);
        if (waitingPending) {
          waitingPending.resolve(payload);
          pendingRequests.delete(waitingId);
        }
      });
      pendingInitRequests.clear();
    }
    return;
  }

  if (type === "error") {
    pending?.reject(new Error(payload as string));
    pendingRequests.delete(id);
    pendingInitRequests.delete(id);
    return;
  }

  if (type === "status") {
    pending?.resolve(payload);
    pendingRequests.delete(id);
    return;
  }
}

function sendMessage(
  type: string,
  payload?: unknown,
  callbacks?: {
    onChunk?: (chunk: string) => void;
    onProgress?: (progress: number, text: string) => void;
  }
): Promise<unknown> {
  initWorker();

  const port = getWorkerPort();
  if (!port) {
    return Promise.reject(new Error("Worker not available"));
  }

  const id = generateId();
  const message = { id, type, payload };

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, {
      resolve,
      reject,
      onChunk: callbacks?.onChunk,
      onProgress: callbacks?.onProgress,
    });

    if ("postMessage" in port) {
      port.postMessage(message);
    }
  });
}

export function useWebLLMSummarizer(model: string, sharedContext?: string) {
  const [status, setStatus] = useState<WebLLMStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const modelRef = useRef(model);
  modelRef.current = model;

  // Check WebGPU support
  useEffect(() => {
    if (!("gpu" in navigator)) {
      setStatus("unavailable");
    }
  }, []);

  // Register progress listener
  useEffect(() => {
    const listener = (prog: number, text: string) => {
      setProgress(prog);
      setProgressText(text);
    };
    progressListeners.add(listener);
    return () => {
      progressListeners.delete(listener);
    };
  }, []);

  // Check current status on mount
  useEffect(() => {
    initWorker();
    sendMessage("status").then((result) => {
      const { loaded, model: loadedModel, isLoading } = result as {
        loaded: boolean;
        model: string | null;
        isLoading: boolean;
      };

      if (isLoading) {
        setStatus("loading");
      } else if (loaded && loadedModel === modelRef.current) {
        setStatus("ready");
      } else {
        setStatus("idle");
      }
    });
  }, []);

  const loadModel = useCallback(async () => {
    if (status === "unavailable") return;

    setStatus("loading");
    setProgress(0);

    try {
      await sendMessage(
        "init",
        { model: modelRef.current },
        {
          onProgress: (prog, text) => {
            setProgress(prog);
            setProgressText(text);
          },
        }
      );
      setStatus("ready");
    } catch (error) {
      console.error("Failed to load model:", error);
      setStatus("idle");
      throw error;
    }
  }, [status]);

  const summarizeStream = useCallback(
    async function* (text: string): AsyncGenerator<string> {
      if (status === "unavailable") {
        throw new Error("WebGPU not available");
      }

      // Load model if not ready
      if (status !== "ready") {
        await loadModel();
      }

      setStatus("generating");

      // Combine prompt and input into a single user message
      const userPrompt = sharedContext || "Summarize the following entries concisely.";
      const combinedContent = `# Task Description\n\n${userPrompt}\n\n---\n\n# Scrum Contents\n\n${text}`;

      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: combinedContent },
      ];

      // Debug: Log the actual prompt
      console.group("🤖 AI Summary Request");
      console.log("User Prompt:", userPrompt);
      console.log("Input Text:", text);
      console.log("--- Combined Message ---");
      console.log(combinedContent);
      console.groupEnd();

      const chunks: string[] = [];
      let resolveNext: ((value: IteratorResult<string>) => void) | null = null;
      let done = false;
      let error: Error | null = null;

      const promise = sendMessage(
        "generate",
        { messages, stream: true },
        {
          onChunk: (chunk) => {
            // If waiting for next chunk, resolve immediately
            // Otherwise, queue it for later consumption
            if (resolveNext) {
              resolveNext({ value: chunk, done: false });
              resolveNext = null;
            } else {
              chunks.push(chunk);
            }
          },
        }
      );

      promise
        .then(() => {
          done = true;
          setStatus("ready");
          if (resolveNext) {
            resolveNext({ value: "", done: true });
          }
        })
        .catch((e) => {
          error = e;
          setStatus("ready");
          if (resolveNext) {
            resolveNext({ value: "", done: true });
          }
        });

      while (!done && !error) {
        if (chunks.length > 0) {
          yield chunks.shift()!;
        } else {
          const result = await new Promise<IteratorResult<string>>(
            (resolve) => {
              resolveNext = resolve;
            }
          );
          if (result.done) break;
          if (result.value) yield result.value;
        }
      }

      if (error) {
        throw error;
      }
    },
    [status, loadModel, sharedContext]
  );

  const unload = useCallback(async () => {
    await sendMessage("unload");
    setStatus("idle");
  }, []);

  return {
    status,
    progress,
    progressText,
    loadModel,
    summarizeStream,
    unload,
  };
}
