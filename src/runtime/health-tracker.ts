/**
 * Runtime health tracking and audit event persistence.
 *
 * Tracks upstream health state (healthy/degraded/unhealthy), restart counts,
 * and audit events (lease changes, tool calls, errors) for dark-factory
 * observability. Persists to JSON files under the MCP² data directory.
 *
 * @module runtime/health-tracker
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

/** Health status for an upstream. */
export type UpstreamHealthStatus = "healthy" | "degraded" | "unhealthy";

/** Persisted health state for a single upstream. */
export interface UpstreamHealth {
  upstreamKey: string;
  status: UpstreamHealthStatus;
  lastConnectedAt?: number;
  lastDisconnectedAt?: number;
  lastErrorAt?: number;
  lastErrorMessage?: string;
  restartCount: number;
  totalToolCalls: number;
  totalErrors: number;
  totalResponseTimeMs: number;
}

/** Audit event types. */
export type AuditEventType =
  | "lease_acquired"
  | "lease_released"
  | "lease_expired"
  | "tool_call"
  | "tool_error"
  | "upstream_connected"
  | "upstream_disconnected"
  | "upstream_error"
  | "upstream_restart";

/** A single audit event. */
export interface AuditEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly type: AuditEventType;
  readonly upstreamKey?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly durationMs?: number;
  readonly details?: Record<string, unknown>;
}

/** Configuration for the health tracker. */
export interface HealthTrackerConfig {
  /** Enable persistence to disk (default: false). */
  enabled: boolean;
  /** Maximum number of audit events to retain (default: 1000). */
  maxAuditEvents: number;
  /** Data directory for persistence. */
  dataDir: string;
}

/** Serialized health store on disk. */
interface HealthStore {
  version: 1;
  upstreams: Record<string, UpstreamHealth>;
  auditEvents: AuditEvent[];
}

// ── HealthTracker ────────────────────────────────────────────────────────────

/**
 * Tracks upstream health and audit events with optional disk persistence.
 */
export class HealthTracker {
  private readonly upstreams = new Map<string, UpstreamHealth>();
  private auditEvents: AuditEvent[] = [];
  private eventIdCounter = 0;
  private readonly config: HealthTrackerConfig;

  constructor(config: HealthTrackerConfig) {
    this.config = config;
  }

  // ── Health state ────────────────────────────────────────────────────────

  /** Records a successful connection for an upstream. */
  recordConnected(upstreamKey: string): void {
    const health = this.getOrCreateHealth(upstreamKey);
    health.status = "healthy";
    health.lastConnectedAt = Date.now();
    this.appendAudit({
      type: "upstream_connected",
      upstreamKey,
    });
  }

  /** Records a disconnection for an upstream. */
  recordDisconnected(upstreamKey: string): void {
    const health = this.getOrCreateHealth(upstreamKey);
    health.status = "unhealthy";
    health.lastDisconnectedAt = Date.now();
    this.appendAudit({
      type: "upstream_disconnected",
      upstreamKey,
    });
  }

  /** Records an error for an upstream. */
  recordError(upstreamKey: string, message: string): void {
    const health = this.getOrCreateHealth(upstreamKey);
    health.status = "unhealthy";
    health.lastErrorAt = Date.now();
    health.lastErrorMessage = message;
    health.totalErrors += 1;
    this.appendAudit({
      type: "upstream_error",
      upstreamKey,
      details: { message },
    });
  }

  /** Records a restart for an upstream. */
  recordRestart(upstreamKey: string): void {
    const health = this.getOrCreateHealth(upstreamKey);
    health.restartCount += 1;
    this.appendAudit({
      type: "upstream_restart",
      upstreamKey,
      details: { restartCount: health.restartCount },
    });
  }

  /** Records a successful tool call. */
  recordToolCall(
    upstreamKey: string,
    durationMs: number,
    context?: { agentId?: string; sessionId?: string; requestId?: string },
  ): void {
    const health = this.getOrCreateHealth(upstreamKey);
    health.totalToolCalls += 1;
    health.totalResponseTimeMs += durationMs;
    this.appendAudit({
      type: "tool_call",
      upstreamKey,
      durationMs,
      ...(context?.agentId != null ? { agentId: context.agentId } : {}),
      ...(context?.sessionId != null ? { sessionId: context.sessionId } : {}),
      ...(context?.requestId != null ? { requestId: context.requestId } : {}),
    });
  }

  /** Records a failed tool call. */
  recordToolError(
    upstreamKey: string,
    message: string,
    durationMs: number,
    context?: { agentId?: string; sessionId?: string; requestId?: string },
  ): void {
    const health = this.getOrCreateHealth(upstreamKey);
    health.totalToolCalls += 1;
    health.totalErrors += 1;
    health.totalResponseTimeMs += durationMs;
    this.appendAudit({
      type: "tool_error",
      upstreamKey,
      durationMs,
      ...(context?.agentId != null ? { agentId: context.agentId } : {}),
      ...(context?.sessionId != null ? { sessionId: context.sessionId } : {}),
      ...(context?.requestId != null ? { requestId: context.requestId } : {}),
      details: { message },
    });
  }

  /** Records a lease event. */
  recordLeaseEvent(
    type: "lease_acquired" | "lease_released" | "lease_expired",
    upstreamKey: string,
    agentId: string,
  ): void {
    this.appendAudit({
      type,
      upstreamKey,
      agentId,
    });
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  /** Returns health state for a specific upstream. */
  getHealth(upstreamKey: string): UpstreamHealth | null {
    return this.upstreams.get(upstreamKey) ?? null;
  }

  /** Returns health state for all tracked upstreams. */
  getAllHealth(): UpstreamHealth[] {
    return Array.from(this.upstreams.values());
  }

  /** Returns recent audit events, most recent first. */
  getAuditEvents(options?: {
    limit?: number;
    upstreamKey?: string;
    type?: AuditEventType;
    since?: number;
  }): AuditEvent[] {
    let events = this.auditEvents;

    if (options?.upstreamKey) {
      events = events.filter((e) => e.upstreamKey === options.upstreamKey);
    }
    if (options?.type) {
      events = events.filter((e) => e.type === options.type);
    }
    if (options?.since != null) {
      const since = options.since;
      events = events.filter((e) => e.timestamp >= since);
    }

    const limit = options?.limit ?? 100;
    return events.slice(-limit).reverse();
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  /** Loads persisted state from disk. */
  async load(): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const filePath = this.getStorePath();
      const raw = await readFile(filePath, "utf-8");
      const store: HealthStore = JSON.parse(raw);

      if (store.version !== 1) return;

      for (const [key, health] of Object.entries(store.upstreams)) {
        this.upstreams.set(key, health);
      }
      this.auditEvents = store.auditEvents ?? [];
      this.eventIdCounter = this.auditEvents.length;
    } catch {
      // File doesn't exist or is corrupt — start fresh.
    }
  }

  /** Persists current state to disk. */
  async save(): Promise<void> {
    if (!this.config.enabled) return;

    const store: HealthStore = {
      version: 1,
      upstreams: Object.fromEntries(this.upstreams),
      auditEvents: this.auditEvents.slice(-this.config.maxAuditEvents),
    };

    const filePath = this.getStorePath();
    await mkdir(this.config.dataDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private getOrCreateHealth(upstreamKey: string): UpstreamHealth {
    let health = this.upstreams.get(upstreamKey);
    if (!health) {
      health = {
        upstreamKey,
        status: "healthy",
        restartCount: 0,
        totalToolCalls: 0,
        totalErrors: 0,
        totalResponseTimeMs: 0,
      };
      this.upstreams.set(upstreamKey, health);
    }
    return health;
  }

  private appendAudit(event: Omit<AuditEvent, "id" | "timestamp">): void {
    this.eventIdCounter += 1;
    const full: AuditEvent = {
      id: `evt_${this.eventIdCounter}`,
      timestamp: Date.now(),
      ...event,
    };
    this.auditEvents.push(full);

    // Trim to max size.
    if (this.auditEvents.length > this.config.maxAuditEvents) {
      this.auditEvents = this.auditEvents.slice(-this.config.maxAuditEvents);
    }
  }

  private getStorePath(): string {
    return join(this.config.dataDir, "health.json");
  }
}
