/**
 * PortHandler - Routes MessagePort messages to appropriate handlers:
 * - TRPC_REQUEST -> RequestHandler.handleLocalRequest()
 * - Control messages -> MessageHandler.processControlMessage()
 */

import type {
  ServiceWorkerContext,
  TRPCPortRequest,
  ControlPortMessage,
  TRPCPortResponse,
  PortMessage,
  ServiceWorkerMessage,
} from '../types';
import type { RequestHandler } from './request';
import type { MessageHandler } from './message';

export class PortHandler {
  constructor(
    private ctx: ServiceWorkerContext,
    private requestHandler: RequestHandler,
    private messageHandler: MessageHandler
  ) {}

  async handleMessage(port: MessagePort, data: PortMessage): Promise<void> {
    if (data.type === 'TRPC_REQUEST') {
      await this.handleTRPCRequest(port, data as TRPCPortRequest);
    } else {
      await this.handleControlMessage(port, data as ControlPortMessage);
    }
  }

  private async handleTRPCRequest(port: MessagePort, request: TRPCPortRequest): Promise<void> {
    const { id, path, input } = request;

    try {
      this.ctx.debug.log('port', `tRPC request: ${path}`);
      const result = await this.requestHandler.handleLocalRequest(path, input);
      port.postMessage({ id, result } as TRPCPortResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.debug.log('port', `tRPC error: ${path}`, message);
      port.postMessage({ id, error: { message } } as TRPCPortResponse);
    }
  }

  private async handleControlMessage(port: MessagePort, message: ControlPortMessage): Promise<void> {
    try {
      const result = await this.messageHandler.processControlMessage(message as ServiceWorkerMessage);
      if (result && typeof result === 'object') {
        port.postMessage({ type: `${message.type}_RESPONSE`, ...result });
      } else {
        port.postMessage({ type: `${message.type}_RESPONSE`, result });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      port.postMessage({ type: `${message.type}_ERROR`, error });
    }
  }
}
