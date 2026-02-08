import type { ServiceWorkerContext, SessionState, SessionEvent, SessionEventType } from './types';
import type { DatabaseManager } from './database';

type SessionEventHandler = (event: SessionEvent) => void | Promise<void>;

export class SessionManager {
  private state: SessionState = 'ANONYMOUS';
  private currentUserId: string | null = null;
  private handlers = new Map<SessionEventType, Set<SessionEventHandler>>();

  constructor(
    private ctx: ServiceWorkerContext,
    private dbManager: DatabaseManager
  ) {}

  getState(): SessionState {
    return this.state;
  }

  getUserId(): string | null {
    return this.currentUserId;
  }

  on(eventType: SessionEventType, handler: SessionEventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  off(eventType: SessionEventType, handler: SessionEventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  private emit(eventType: SessionEventType, event: SessionEvent): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (err) {
          this.ctx.debug.log('session', `Error in ${eventType} handler:`, err);
        }
      });
    }
  }

  async transition(event: SessionEvent): Promise<void> {
    const versionAtStart = this.dbManager.getSwitchVersion();

    this.ctx.debug.log('session', `Transition: ${this.state} + ${event.type}`, event);

    switch (event.type) {
      case 'LOGIN_STARTED':
        if (this.state === 'ANONYMOUS' || this.state === 'AUTHENTICATED') {
          this.state = 'SWITCHING';
          this.currentUserId = event.userId || null;
          await this.dbManager.switchToUser(this.currentUserId);

          // Check for stale transition
          if (this.dbManager.getSwitchVersion() !== versionAtStart + 1) {
            this.ctx.debug.log('session', 'Stale LOGIN_STARTED transition, aborting');
            return;
          }

          this.emit('LOGIN_STARTED', event);
        }
        break;

      case 'LOGIN_COMPLETED':
        if (this.state === 'SWITCHING') {
          this.state = 'AUTHENTICATED';
          this.emit('LOGIN_COMPLETED', event);
        }
        break;

      case 'LOGOUT_STARTED':
        if (this.state === 'AUTHENTICATED') {
          this.state = 'SWITCHING';
          await this.dbManager.persist();
          this.emit('LOGOUT_STARTED', event);
        }
        break;

      case 'LOGOUT_COMPLETED':
        if (this.state === 'SWITCHING') {
          this.currentUserId = null;
          await this.dbManager.switchToUser(null);
          this.state = 'ANONYMOUS';
          this.emit('LOGOUT_COMPLETED', event);
        }
        break;

      case 'SYNC_STARTED':
        this.emit('SYNC_STARTED', event);
        break;

      case 'SYNC_COMPLETED':
        this.emit('SYNC_COMPLETED', event);
        break;

      case 'SYNC_FAILED':
        this.emit('SYNC_FAILED', event);
        break;

      default:
        this.ctx.debug.log('session', `Unknown event type: ${(event as SessionEvent).type}`);
    }

    this.ctx.debug.log('session', `State after transition: ${this.state}`);
  }

  // Convenience method to check if user is authenticated
  isAuthenticated(): boolean {
    return this.state === 'AUTHENTICATED';
  }

  // Convenience method to check if currently switching
  isSwitching(): boolean {
    return this.state === 'SWITCHING';
  }
}
