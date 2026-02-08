import type { ServiceWorkerContext } from './types';
import { createDebugger } from './debug';

declare const __API_URL__: string | undefined;

interface EventEmitter {
  emit(event: string, data?: unknown): void;
  on(event: string, handler: (data?: unknown) => void): void;
  off(event: string, handler: (data?: unknown) => void): void;
}

function createEventEmitter(): EventEmitter {
  const listeners = new Map<string, Set<(data?: unknown) => void>>();
  return {
    emit(event: string, data?: unknown): void {
      listeners.get(event)?.forEach((handler) => handler(data));
    },
    on(event: string, handler: (data?: unknown) => void): void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    },
    off(event: string, handler: (data?: unknown) => void): void {
      listeners.get(event)?.delete(handler);
    },
  };
}

export function createSharedWorkerContext(): ServiceWorkerContext {
  // SharedWorker cannot use dev server proxy, so we need the actual backend URL
  // In production, __API_URL__ should be set to the actual backend
  // In development, fall back to localhost:3081 (the backend)
  const apiUrl = (typeof __API_URL__ !== 'undefined' && __API_URL__)
    ? __API_URL__
    : 'http://localhost:3081';
  return {
    apiUrl,
    debug: createDebugger(),
    events: createEventEmitter(),
  };
}
