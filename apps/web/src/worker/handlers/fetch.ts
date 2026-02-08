/**
 * Fetch Handler
 *
 * Handles service worker fetch events for local-first tRPC requests.
 * Routes /trpc requests to local database or server based on procedure type.
 *
 * CRITICAL: Anonymous users must NEVER have requests go to server (except auth.*).
 * This prevents data isolation bugs where anonymous data could leak to/from server.
 */

import type { ServiceWorkerContext } from '../types';
import type { RequestHandler } from './request';

export interface FetchHandlerConfig {
  /** Get current user ID (null for anonymous) */
  getCurrentUserId: () => string | null;
}

export class FetchHandler {
  constructor(
    private ctx: ServiceWorkerContext,
    private requestHandler: RequestHandler,
    private config: FetchHandlerConfig
  ) {}

  /**
   * Handle a fetch event
   * @param request - Fetch request
   * @returns Response if handled, undefined to let pass through
   */
  async handleFetch(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);

    // Only intercept /trpc requests that should be handled locally
    if (url.pathname.startsWith('/trpc/')) {
      return this.handleTRPCRequest(request, url);
    }

    // Let other requests pass through
    return undefined;
  }

  /**
   * Handle a tRPC request (either locally or pass to server)
   * @param request - Fetch request
   * @param url - Parsed URL
   * @returns Response
   */
  private async handleTRPCRequest(request: Request, url: URL): Promise<Response> {
    const pathname = url.pathname.replace('/trpc/', '');

    this.ctx.debug.log('fetch', `tRPC request: ${pathname}`);

    // Handle batch requests (multiple procedures in one call)
    if (pathname.includes(',')) {
      return this.handleBatchRequest(request, url, pathname);
    }

    // Single procedure
    return this.handleSingleRequest(request, url, pathname);
  }

  /**
   * Handle a batch tRPC request
   */
  private async handleBatchRequest(request: Request, url: URL, pathname: string): Promise<Response> {
    const procedures = pathname.split(',');
    this.ctx.debug.log('fetch', `Batch tRPC procedures: ${procedures.join(', ')}`);

    // Check if ALL procedures are server-only
    const allServerOnly = procedures.every(proc => this.shouldPassToServer(proc));

    if (allServerOnly) {
      this.ctx.debug.log('fetch', 'All server-only, passing through to network');
      return fetch(request);
    }

    // Handle batch locally
    try {
      let input: Record<string, unknown> = {};

      if (request.method === 'GET') {
        const inputParam = url.searchParams.get('input');
        input = inputParam ? JSON.parse(inputParam) : {};
      } else {
        const body = await request.text();
        input = body ? JSON.parse(body) : {};
      }

      const results = await Promise.all(
        procedures.map((proc, i) =>
          this.requestHandler.handleLocalRequest(proc, input[String(i)] || {})
        )
      );

      return new Response(
        JSON.stringify(results.map((data) => ({ result: { data } }))),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.debug.log('fetch', `Error handling batch request:`, message);

      return new Response(JSON.stringify({ error: { message } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Handle a single tRPC request
   */
  private async handleSingleRequest(request: Request, url: URL, procedure: string): Promise<Response> {
    // Certain procedures must go to server (auth, webhooks, sync)
    if (this.shouldPassToServer(procedure)) {
      this.ctx.debug.log('fetch', `Passing to server: ${procedure}`);
      return fetch(request);
    }

    try {
      // Parse input from query string (GET) or body (POST)
      let input: unknown;
      if (request.method === 'GET') {
        const inputParam = url.searchParams.get('input');
        const parsedInput = inputParam ? JSON.parse(inputParam) : {};
        // Handle both single query (input.0) and direct input
        input = parsedInput['0'] || parsedInput;
      } else {
        const body = await request.text();
        const parsedInput = body ? JSON.parse(body) : {};
        // Handle both mutation (input.0) and direct input
        input = parsedInput['0'] || parsedInput;
      }

      // Handle locally
      const result = await this.requestHandler.handleLocalRequest(procedure, input);

      return new Response(JSON.stringify({ result: { data: result } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.debug.log('fetch', `Error handling ${procedure}:`, message);

      return new Response(JSON.stringify({ error: { message } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Check if a procedure should be passed to server instead of handled locally.
   *
   * CRITICAL: Anonymous users must NEVER have data requests go to server.
   * Only auth.* procedures are allowed for anonymous users (for login flow).
   */
  private shouldPassToServer(procedure: string): boolean {
    const userId = this.config.getCurrentUserId();
    const isAnonymous = userId === null;

    // Auth procedures always go to server (needed for login flow)
    if (procedure.startsWith('auth.')) return true;

    // CRITICAL: Anonymous users must NEVER call server for non-auth procedures
    // This prevents data isolation bugs where anonymous data could leak to/from server
    if (isAnonymous) {
      this.ctx.debug.log(
        'fetch',
        `BLOCKING server call for anonymous user: ${procedure}`
      );
      return false;
    }

    // Logged-in users: allow webhooks and sync to go to server
    if (procedure.startsWith('webhooks.')) return true;
    if (procedure.startsWith('sync.')) return true;

    return false;
  }
}
