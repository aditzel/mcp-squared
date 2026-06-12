/**
 * Runtime supervision primitives for upstream MCP servers.
 *
 * These helpers keep lifecycle and concurrency policy separate from the
 * Cataloger transport code so local stdio servers can be shared safely by
 * multiple agents while remote HTTP/SSE upstreams keep proxy-style behavior.
 *
 * @module runtime/supervisor
 */

import {
  type EffectiveUpstreamRuntimeConfig,
  resolveUpstreamRuntimeDefaults,
  type UpstreamServerConfig,
} from "../config/schema.js";

/** Runtime call identity supplied by daemon/proxy/session-aware callers. */
export interface RuntimeCallContext {
  /** Stable agent/client identifier when known. */
  agentId?: string;
  /** Stable MCP session identifier when known. */
  sessionId?: string;
  /** Optional request identifier for audit/monitoring integrations. */
  requestId?: string;
  /** Operation intent; unknown tool calls are treated like writes. */
  intent?: "read" | "write";
}

/** Schedules upstream calls according to the upstream runtime concurrency mode. */
export interface RuntimeCallRunner {
  run<T>(
    upstreamKey: string,
    config: UpstreamServerConfig,
    operation: () => Promise<T> | T,
    context?: RuntimeCallContext,
  ): Promise<T>;
}

/**
 * Serializes or parallelizes calls for an upstream according to effective
 * runtime policy.
 */
export class UpstreamCallSupervisor implements RuntimeCallRunner {
  private readonly queues = new Map<string, Promise<unknown>>();

  async run<T>(
    upstreamKey: string,
    config: UpstreamServerConfig,
    operation: () => Promise<T> | T,
    context: RuntimeCallContext = {},
  ): Promise<T> {
    const runtime = resolveUpstreamRuntimeDefaults(config);
    const lockKey = this.getLockKey(upstreamKey, runtime, context);
    if (!lockKey) {
      return operation();
    }

    return this.runLocked(lockKey, operation);
  }

  private getLockKey(
    upstreamKey: string,
    runtime: EffectiveUpstreamRuntimeConfig,
    context: RuntimeCallContext,
  ): string | null {
    switch (runtime.concurrency) {
      case "exclusive":
        return `upstream:${upstreamKey}`;
      case "shared_read":
        return context.intent === "read" ? null : `upstream:${upstreamKey}`;
      case "session_affine": {
        const identity = context.sessionId ?? context.agentId;
        return identity ? `upstream:${upstreamKey}:session:${identity}` : null;
      }
      case "parallel":
        return null;
    }
  }

  private runLocked<T>(
    lockKey: string,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const previous = this.queues.get(lockKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);

    let cleanup: Promise<unknown>;
    cleanup = current.finally(() => {
      if (this.queues.get(lockKey) === cleanup) {
        this.queues.delete(lockKey);
      }
    });
    this.queues.set(lockKey, cleanup);

    return current;
  }
}

/** Creates a runtime handle for an upstream. */
export type CreateRuntimeHandle<THandle> = (
  upstreamKey: string,
  config: UpstreamServerConfig,
  runtime: EffectiveUpstreamRuntimeConfig,
) => Promise<THandle> | THandle;

/** Disposes a retained runtime handle. */
export type DisposeRuntimeHandle<THandle> = (
  handle: THandle,
  upstreamKey: string,
) => Promise<void> | void;

/** Runtime supervisor construction options. */
export interface UpstreamRuntimeSupervisorOptions<THandle> {
  createRuntime: CreateRuntimeHandle<THandle>;
  disposeRuntime?: DisposeRuntimeHandle<THandle>;
}

interface RuntimeGroup<THandle> {
  upstreamKey: string;
  handles: Promise<THandle>[];
  cursor: number;
}

/**
 * Retains singleton/proxy runtime handles and creates fresh handles for
 * ephemeral upstreams. Pooled upstreams allocate up to maxPoolSize handles and
 * then use round-robin selection.
 */
export class UpstreamRuntimeSupervisor<THandle> {
  private readonly groups = new Map<string, RuntimeGroup<THandle>>();

  constructor(
    private readonly options: UpstreamRuntimeSupervisorOptions<THandle>,
  ) {}

  async getRuntime(
    upstreamKey: string,
    config: UpstreamServerConfig,
  ): Promise<THandle> {
    const runtime = resolveUpstreamRuntimeDefaults(config);
    if (runtime.lifecycle === "ephemeral") {
      return this.options.createRuntime(upstreamKey, config, runtime);
    }

    const groupKey = this.getGroupKey(upstreamKey, runtime);
    const group = this.getOrCreateGroup(groupKey, upstreamKey);

    if (runtime.lifecycle === "pooled") {
      return this.getPooledRuntime(
        groupKey,
        group,
        upstreamKey,
        config,
        runtime,
      );
    }

    if (group.handles[0]) {
      return group.handles[0];
    }

    const handle = this.createRetainedRuntime(
      groupKey,
      group,
      upstreamKey,
      config,
      runtime,
    );
    group.handles.push(handle);
    return handle;
  }

  /** Disposes retained runtime handles for one upstream, or all upstreams. */
  async dispose(upstreamKey?: string): Promise<void> {
    const groups = Array.from(this.groups.entries()).filter(
      ([, group]) =>
        upstreamKey === undefined || group.upstreamKey === upstreamKey,
    );

    for (const [groupKey, group] of groups) {
      this.groups.delete(groupKey);
      await Promise.allSettled(
        group.handles.map((handle) =>
          this.disposeRuntime(handle, group.upstreamKey),
        ),
      );
    }
  }

  /** Number of retained runtime handles. Ephemeral handles are not retained. */
  getRetainedRuntimeCount(): number {
    let count = 0;
    for (const group of this.groups.values()) {
      count += group.handles.length;
    }
    return count;
  }

  private getPooledRuntime(
    groupKey: string,
    group: RuntimeGroup<THandle>,
    upstreamKey: string,
    config: UpstreamServerConfig,
    runtime: EffectiveUpstreamRuntimeConfig,
  ): Promise<THandle> {
    if (group.handles.length < runtime.maxPoolSize) {
      const handle = this.createRetainedRuntime(
        groupKey,
        group,
        upstreamKey,
        config,
        runtime,
      );
      group.handles.push(handle);
      return handle;
    }

    const index = group.cursor % group.handles.length;
    group.cursor += 1;
    return group.handles[index] as Promise<THandle>;
  }

  private createRetainedRuntime(
    groupKey: string,
    group: RuntimeGroup<THandle>,
    upstreamKey: string,
    config: UpstreamServerConfig,
    runtime: EffectiveUpstreamRuntimeConfig,
  ): Promise<THandle> {
    const handle = Promise.resolve(
      this.options.createRuntime(upstreamKey, config, runtime),
    ).catch((error) => {
      const current = this.groups.get(groupKey);
      if (current === group) {
        current.handles = current.handles.filter((entry) => entry !== handle);
        if (current.handles.length === 0) {
          this.groups.delete(groupKey);
        }
      }
      throw error;
    });
    return handle;
  }

  private async disposeRuntime(
    handle: Promise<THandle>,
    upstreamKey: string,
  ): Promise<void> {
    try {
      const runtime = await handle;
      await this.options.disposeRuntime?.(runtime, upstreamKey);
    } catch {
      // Failed runtime creation leaves nothing reliable to dispose.
    }
  }

  private getOrCreateGroup(
    groupKey: string,
    upstreamKey: string,
  ): RuntimeGroup<THandle> {
    let group = this.groups.get(groupKey);
    if (!group) {
      group = { upstreamKey, handles: [], cursor: 0 };
      this.groups.set(groupKey, group);
    }
    return group;
  }

  private getGroupKey(
    upstreamKey: string,
    runtime: EffectiveUpstreamRuntimeConfig,
  ): string {
    return `${upstreamKey}\0${runtime.lifecycle}`;
  }
}
