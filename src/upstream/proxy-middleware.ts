/**
 * Remote proxy middleware for SSE/HTTP upstreams.
 *
 * Provides richer middleware hooks for auth, session affinity,
 * request/response transformation, and retry logic beyond the
 * current session/client identity threading.
 *
 * @module upstream/proxy-middleware
 */

import type { RuntimeCallContext } from "../runtime/supervisor.js";

/** Middleware execution phases. */
export type MiddlewarePhase =
  | "before_connect"
  | "after_connect"
  | "before_call"
  | "after_call"
  | "on_error";

/** Context passed to middleware functions. */
export interface MiddlewareContext {
  /** Upstream key. */
  upstreamKey: string;
  /** Current runtime call context. */
  callContext?: RuntimeCallContext;
  /** Request metadata. */
  request?: {
    method: string;
    params?: unknown;
  };
  /** Response metadata (after_call phase). */
  response?: {
    result?: unknown;
    error?: Error;
  };
  /** Shared state bag for middleware chain. */
  state: Record<string, unknown>;
}

/** Middleware function signature. */
export type MiddlewareFn = (ctx: MiddlewareContext) => Promise<void> | void;

/** Middleware registration options. */
export interface MiddlewareOptions {
  /** Phases this middleware applies to. */
  phases: MiddlewarePhase[];
  /** Priority (lower = earlier execution). Default: 100. */
  priority?: number;
  /** Optional filter function. */
  filter?: (ctx: MiddlewareContext) => boolean;
}

/** Registered middleware entry. */
interface RegisteredMiddleware {
  name: string;
  fn: MiddlewareFn;
  options: MiddlewareOptions;
}

/**
 * Middleware chain for remote proxy operations.
 */
export class ProxyMiddleware {
  private readonly middlewares: RegisteredMiddleware[] = [];

  /**
   * Registers a middleware function.
   */
  use(name: string, fn: MiddlewareFn, options: MiddlewareOptions): void {
    this.middlewares.push({ name, fn, options });
    this.middlewares.sort(
      (a, b) => (a.options.priority ?? 100) - (b.options.priority ?? 100),
    );
  }

  /**
   * Removes a middleware by name.
   */
  remove(name: string): void {
    const index = this.middlewares.findIndex((m) => m.name === name);
    if (index >= 0) {
      this.middlewares.splice(index, 1);
    }
  }

  /**
   * Executes all middlewares for a given phase.
   */
  async execute(phase: MiddlewarePhase, ctx: MiddlewareContext): Promise<void> {
    for (const middleware of this.middlewares) {
      if (!middleware.options.phases.includes(phase)) {
        continue;
      }

      if (middleware.options.filter && !middleware.options.filter(ctx)) {
        continue;
      }

      await middleware.fn(ctx);
    }
  }

  /**
   * Returns the number of registered middlewares.
   */
  get size(): number {
    return this.middlewares.length;
  }

  /**
   * Clears all middlewares.
   */
  clear(): void {
    this.middlewares.length = 0;
  }
}

// ── Built-in Middleware ──────────────────────────────────────────────────────

/**
 * Session affinity middleware.
 * Ensures requests from the same session are routed consistently.
 */
export function createSessionAffinityMiddleware(): {
  name: string;
  fn: MiddlewareFn;
  options: MiddlewareOptions;
} {
  const sessionMap = new Map<string, string>();

  return {
    name: "session-affinity",
    fn: (ctx) => {
      const sessionId = ctx.callContext?.sessionId;
      if (!sessionId) return;

      // Track session -> upstream mapping
      const existing = sessionMap.get(sessionId);
      if (existing && existing !== ctx.upstreamKey) {
        // Session was previously on a different upstream
        ctx.state["sessionAffinityConflict"] = true;
        ctx.state["previousUpstream"] = existing;
      }
      sessionMap.set(sessionId, ctx.upstreamKey);
    },
    options: {
      phases: ["before_call"],
      priority: 50,
    },
  };
}

/**
 * Request logging middleware.
 * Logs all requests and responses for audit purposes.
 */
export function createRequestLoggingMiddleware(
  logger: (message: string) => void = console.log,
): {
  name: string;
  fn: MiddlewareFn;
  options: MiddlewareOptions;
} {
  return {
    name: "request-logging",
    fn: (ctx) => {
      const agent = ctx.callContext?.agentId ?? "unknown";
      const session = ctx.callContext?.sessionId ?? "none";

      if (ctx.request) {
        logger(
          `[proxy] ${ctx.upstreamKey} agent=${agent} session=${session} method=${ctx.request.method}`,
        );
      }

      if (ctx.response?.error) {
        logger(
          `[proxy] ${ctx.upstreamKey} error: ${ctx.response.error.message}`,
        );
      }
    },
    options: {
      phases: ["before_call", "after_call", "on_error"],
      priority: 200,
    },
  };
}

/**
 * Retry middleware with exponential backoff.
 * Retries failed requests up to maxRetries times.
 */
export function createRetryMiddleware(
  maxRetries = 3,
  baseDelayMs = 100,
): {
  name: string;
  fn: MiddlewareFn;
  options: MiddlewareOptions;
} {
  return {
    name: "retry",
    fn: (ctx) => {
      const retryCount = (ctx.state["retryCount"] as number) ?? 0;
      if (ctx.response?.error && retryCount < maxRetries) {
        ctx.state["retryCount"] = retryCount + 1;
        ctx.state["retryDelayMs"] = baseDelayMs * 2 ** retryCount;
        ctx.state["shouldRetry"] = true;
      }
    },
    options: {
      phases: ["after_call"],
      priority: 150,
    },
  };
}

/**
 * Auth token injection middleware.
 * Injects auth tokens from the state bag into request headers.
 */
export function createAuthInjectionMiddleware(): {
  name: string;
  fn: MiddlewareFn;
  options: MiddlewareOptions;
} {
  return {
    name: "auth-injection",
    fn: (ctx) => {
      const token = ctx.state["authToken"] as string | undefined;
      if (token && ctx.request) {
        ctx.state["headers"] = {
          ...(ctx.state["headers"] as Record<string, string>),
          Authorization: `Bearer ${token}`,
        };
      }
    },
    options: {
      phases: ["before_call"],
      priority: 30,
      filter: (ctx) => ctx.state["authToken"] != null,
    },
  };
}
