import { TRPCLink, TRPCClientError } from '@trpc/client';
import { observable, type Observer } from '@trpc/server/observable';
import type { AppRouter } from '@til-stack/api/routes';
import type { TRPCClientRuntime } from '@trpc/client';

/**
 * Custom tRPC link for SharedWorker communication via MessagePort.
 * Uses single-message pattern (no batching) since MessagePort has <1ms overhead.
 */
export function sharedWorkerLink(
  getPort: () => MessagePort | null
): TRPCLink<AppRouter> {
  return function linkFactory(_runtime: TRPCClientRuntime) {
    return function linkHandler({ op }) {
      return observable(function subscribe(observer: Observer<unknown, unknown>) {
        const port = getPort();
        if (!port) {
          observer.error(new TRPCClientError('SharedWorker not connected'));
          return;
        }

        if (op.type === 'subscription') {
          observer.error(new TRPCClientError(
            'Subscriptions are not supported via SharedWorker. ' +
            'Use polling or a separate WebSocket connection for real-time updates.'
          ));
          return;
        }

        const id = crypto.randomUUID();

        function handleMessage(event: MessageEvent): void {
          if (event.data.id !== id) return;

          if (event.data.error) {
            observer.error(new TRPCClientError(event.data.error.message));
          } else {
            observer.next({ result: { data: event.data.result } });
            observer.complete();
          }
        }

        port.addEventListener('message', handleMessage);

        port.postMessage({
          type: 'TRPC_REQUEST',
          id,
          method: op.type,
          path: op.path,
          input: op.input,
        });

        return function cleanup(): void {
          port.removeEventListener('message', handleMessage);
        };
      });
    };
  };
}
