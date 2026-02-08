type MessageCallback = (data: unknown) => void;

const RESPONSE_TIMEOUT_MS = 30000;

export class SharedWorkerClient {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private messageCallbacks = new Map<string, Set<MessageCallback>>();
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    this.connect();
  }

  private connect(): void {
    if (typeof SharedWorker === 'undefined') {
      console.warn('[SharedWorkerClient] SharedWorker not supported');
      return;
    }

    try {
      this.worker = new SharedWorker(
        new URL('../shared-worker.ts', import.meta.url),
        { type: 'module', name: 'til-stack-trpc' }
      );

      this.port = this.worker.port;
      this.port.onmessage = this.handleMessage.bind(this);
      this.port.start();

      this.readyResolve?.();
    } catch (err) {
      console.error('[SharedWorkerClient] Failed to connect:', err);
    }
  }

  private handleMessage(event: MessageEvent): void {
    const { type, id } = event.data;

    if (id) {
      this.notifyCallbacks('TRPC_RESPONSE', event.data);
    }

    if (type) {
      this.notifyCallbacks(type, event.data);
    }
  }

  private notifyCallbacks(type: string, data: unknown): void {
    const callbacks = this.messageCallbacks.get(type);
    callbacks?.forEach((cb) => cb(data));
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  getPort(): MessagePort | null {
    return this.port;
  }

  send<T>(message: Record<string, unknown>): Promise<T> {
    if (!this.port) {
      return Promise.reject(new Error('SharedWorker not connected'));
    }

    const responseType = `${message.type}_RESPONSE`;
    const errorType = `${message.type}_ERROR`;

    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout>;

      const cleanup = (): void => {
        clearTimeout(timeoutId);
        this.off(responseType, handleResponse);
        this.off(errorType, handleError);
      };

      const handleResponse = (data: unknown): void => {
        cleanup();
        resolve(data as T);
      };

      const handleError = (data: unknown): void => {
        cleanup();
        reject(new Error((data as { error: string }).error));
      };

      this.on(responseType, handleResponse);
      this.on(errorType, handleError);

      this.port!.postMessage(message);

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('SharedWorker timeout'));
      }, RESPONSE_TIMEOUT_MS);
    });
  }

  on(type: string, callback: MessageCallback): void {
    if (!this.messageCallbacks.has(type)) {
      this.messageCallbacks.set(type, new Set());
    }
    this.messageCallbacks.get(type)!.add(callback);
  }

  off(type: string, callback: MessageCallback): void {
    this.messageCallbacks.get(type)?.delete(callback);
  }
}

export const sharedWorkerClient = new SharedWorkerClient();
