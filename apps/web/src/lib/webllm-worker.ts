// WebLLM Shared Worker
// This worker is shared across all tabs and maintains a single LLM engine instance

/// <reference lib="webworker" />

declare const self: SharedWorkerGlobalScope | DedicatedWorkerGlobalScope;

import {
  MLCEngine,
  CreateMLCEngine,
  InitProgressReport,
  ChatCompletionMessageParam,
} from "@mlc-ai/web-llm";

interface WorkerMessage {
  id: string;
  type: "init" | "generate" | "status" | "unload";
  payload?: unknown;
}

interface InitPayload {
  model: string;
}

interface GeneratePayload {
  messages: ChatCompletionMessageParam[];
  stream?: boolean;
}

interface WorkerResponse {
  id: string;
  type: "progress" | "chunk" | "complete" | "error" | "status";
  payload?: unknown;
}

let engine: MLCEngine | null = null;
let currentModel: string | null = null;
let isLoading = false;
let lastProgress = 0;
let lastProgressText = "";
const ports: MessagePort[] = [];

// Broadcast to all connected ports
function broadcast(response: WorkerResponse) {
  ports.forEach((port) => {
    try {
      port.postMessage(response);
    } catch {
      // Port may be closed
    }
  });
}

// Send to specific port
function respond(port: MessagePort, response: WorkerResponse) {
  try {
    port.postMessage(response);
  } catch {
    // Port may be closed
  }
}

async function initEngine(port: MessagePort, id: string, model: string) {
  // If already loading, send current progress instead of error
  if (isLoading) {
    // Send current progress to the new requestor
    respond(port, {
      id,
      type: "progress",
      payload: {
        progress: lastProgress,
        text: lastProgressText || "Loading model...",
        alreadyLoading: true,
      },
    });
    return;
  }

  if (engine && currentModel === model) {
    respond(port, {
      id,
      type: "complete",
      payload: { status: "already_loaded" },
    });
    return;
  }

  if (engine) {
    await engine.unload();
    engine = null;
  }

  isLoading = true;
  currentModel = model;
  lastProgress = 0;
  lastProgressText = "";

  try {
    engine = await CreateMLCEngine(model, {
      initProgressCallback: (report: InitProgressReport) => {
        lastProgress = report.progress;
        lastProgressText = report.text;
        broadcast({
          id,
          type: "progress",
          payload: {
            progress: report.progress,
            text: report.text,
          },
        });
      },
    });

    isLoading = false;
    // Broadcast complete to all ports (not just the initiator)
    broadcast({
      id,
      type: "complete",
      payload: { status: "loaded" },
    });
  } catch (error) {
    isLoading = false;
    currentModel = null;
    respond(port, {
      id,
      type: "error",
      payload: error instanceof Error ? error.message : "Failed to load model",
    });
  }
}

async function generate(
  port: MessagePort,
  id: string,
  messages: ChatCompletionMessageParam[],
  stream: boolean
) {
  if (!engine) {
    respond(port, {
      id,
      type: "error",
      payload: "Engine not initialized",
    });
    return;
  }

  try {
    if (stream) {
      const response = await engine.chat.completions.create({
        messages,
        stream: true,
      });

      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          respond(port, {
            id,
            type: "chunk",
            payload: content,
          });
        }
      }

      respond(port, {
        id,
        type: "complete",
        payload: { done: true },
      });
    } else {
      const response = await engine.chat.completions.create({
        messages,
        stream: false,
      });

      respond(port, {
        id,
        type: "complete",
        payload: { content: response.choices[0]?.message?.content || "" },
      });
    }
  } catch (error) {
    respond(port, {
      id,
      type: "error",
      payload: error instanceof Error ? error.message : "Generation failed",
    });
  }
}

function getStatus(port: MessagePort, id: string) {
  respond(port, {
    id,
    type: "status",
    payload: {
      loaded: !!engine,
      model: currentModel,
      isLoading,
    },
  });
}

async function unload(port: MessagePort, id: string) {
  if (engine) {
    await engine.unload();
    engine = null;
    currentModel = null;
  }
  respond(port, {
    id,
    type: "complete",
    payload: { status: "unloaded" },
  });
}

function handleMessage(port: MessagePort, message: WorkerMessage) {
  const { id, type, payload } = message;

  switch (type) {
    case "init":
      initEngine(port, id, (payload as InitPayload).model);
      break;
    case "generate":
      const genPayload = payload as GeneratePayload;
      generate(port, id, genPayload.messages, genPayload.stream ?? true);
      break;
    case "status":
      getStatus(port, id);
      break;
    case "unload":
      unload(port, id);
      break;
  }
}

// Shared Worker connection handler
if ("onconnect" in self) {
  (self as SharedWorkerGlobalScope).onconnect = (event: MessageEvent) => {
    const port = event.ports[0];
    ports.push(port);

    port.onmessage = (e: MessageEvent<WorkerMessage>) => {
      handleMessage(port, e.data);
    };

    port.start();
  };
} else {
  // For regular Web Worker fallback
  self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    // Create a fake port for regular worker
    const fakePort = {
      postMessage: (msg: unknown) => (self as DedicatedWorkerGlobalScope).postMessage(msg),
    } as MessagePort;

    if (!ports.includes(fakePort)) {
      ports.push(fakePort);
    }

    handleMessage(fakePort, e.data);
  };
}
