import type { ServiceWorkerContext } from './types';
import { createDebugger } from './debug';

// Simple event emitter
function createEventEmitter() {
  const listeners = new Map<string, Set<(data?: unknown) => void>>();

  return {
    emit(event: string, data?: unknown) {
      const handlers = listeners.get(event);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(data);
          } catch (err) {
            console.error(`[SW:events] Error in handler for ${event}:`, err);
          }
        });
      }
    },
    on(event: string, handler: (data?: unknown) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    },
    off(event: string, handler: (data?: unknown) => void) {
      listeners.get(event)?.delete(handler);
    },
  };
}

export function createServiceWorkerContext(): ServiceWorkerContext {
  const apiUrl = (self as unknown as { API_URL?: string }).API_URL || '';

  return {
    apiUrl,
    debug: createDebugger(),
    events: createEventEmitter(),
  };
}
