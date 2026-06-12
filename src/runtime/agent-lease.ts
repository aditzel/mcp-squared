/**
 * Agent lease management for temporary exclusive upstream access.
 *
 * An agent lease grants time-bounded exclusive access to an upstream MCP
 * server. While a lease is active, other agents' calls are queued until
 * the lease is released or expires.
 *
 * @module runtime/agent-lease
 */

/** Active agent lease for an upstream. */
export interface AgentLease {
  /** Upstream key this lease applies to. */
  readonly upstreamKey: string;
  /** Agent/client identifier holding the lease. */
  readonly agentId: string;
  /** Timestamp when the lease was acquired (ms since epoch). */
  readonly acquiredAt: number;
  /** Timestamp when the lease expires (ms since epoch). */
  readonly expiresAt: number;
}

/** Options for acquiring an agent lease. */
export interface AcquireLeaseOptions {
  /** Lease time-to-live in milliseconds. Default: 300000 (5 minutes). */
  ttlMs?: number;
}

const DEFAULT_LEASE_TTL_MS = 300_000;

/**
 * Manages time-bounded exclusive leases on upstream MCP servers.
 *
 * Each upstream can have at most one active lease at a time. Leases
 * are automatically cleaned up when they expire or when explicitly
 * released.
 */
export class AgentLeaseManager {
  private readonly leases = new Map<string, AgentLease>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Acquires an exclusive lease on an upstream.
   *
   * If the upstream is already leased by a different agent, an error is thrown.
   * If the upstream is already leased by the same agent, the lease is renewed.
   *
   * @throws {Error} If the upstream is leased by a different agent.
   */
  acquire(
    upstreamKey: string,
    agentId: string,
    options: AcquireLeaseOptions = {},
  ): AgentLease {
    const existing = this.leases.get(upstreamKey);
    const now = Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;

    if (existing && existing.agentId !== agentId && existing.expiresAt > now) {
      throw new Error(
        `Upstream '${upstreamKey}' is already leased by ${existing.agentId}`,
      );
    }

    const lease: AgentLease = {
      upstreamKey,
      agentId,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };

    this.setLease(upstreamKey, lease);
    return lease;
  }

  /**
   * Releases a lease held by the specified agent.
   * No-op if the agent does not hold the lease.
   */
  release(upstreamKey: string, agentId: string): void {
    const existing = this.leases.get(upstreamKey);
    if (existing && existing.agentId === agentId) {
      this.clearLease(upstreamKey);
    }
  }

  /**
   * Releases the lease on an upstream regardless of holder.
   *
   * @returns true if a lease was released, false if none existed.
   */
  releaseLease(upstreamKey: string): boolean {
    if (this.leases.has(upstreamKey)) {
      this.clearLease(upstreamKey);
      return true;
    }
    return false;
  }

  /**
   * Renews an existing lease held by the specified agent.
   * No-op if the agent does not hold the lease.
   */
  renew(upstreamKey: string, agentId: string, ttlMs: number): void {
    const existing = this.leases.get(upstreamKey);
    if (existing && existing.agentId === agentId) {
      const renewed: AgentLease = {
        ...existing,
        expiresAt: Date.now() + ttlMs,
      };
      this.setLease(upstreamKey, renewed);
    }
  }

  /** Returns true if the upstream has an active (non-expired) lease. */
  isLeased(upstreamKey: string): boolean {
    const lease = this.leases.get(upstreamKey);
    if (!lease) return false;
    if (lease.expiresAt <= Date.now()) {
      this.clearLease(upstreamKey);
      return false;
    }
    return true;
  }

  /** Returns true if the specified agent holds the active lease. */
  isLeaseHolder(upstreamKey: string, agentId: string): boolean {
    const lease = this.leases.get(upstreamKey);
    if (!lease) return false;
    if (lease.expiresAt <= Date.now()) {
      this.clearLease(upstreamKey);
      return false;
    }
    return lease.agentId === agentId;
  }

  /** Returns the active lease for an upstream, or null if unleased. */
  getLease(upstreamKey: string): AgentLease | null {
    const lease = this.leases.get(upstreamKey);
    if (!lease) return null;
    if (lease.expiresAt <= Date.now()) {
      this.clearLease(upstreamKey);
      return null;
    }
    return lease;
  }

  /** Returns all active leases. */
  getLeases(): AgentLease[] {
    const now = Date.now();
    const active: AgentLease[] = [];
    for (const [key, lease] of this.leases) {
      if (lease.expiresAt <= now) {
        this.clearLease(key);
      } else {
        active.push(lease);
      }
    }
    return active;
  }

  /** Releases all leases for a specific upstream. */
  dispose(upstreamKey: string): void {
    this.clearLease(upstreamKey);
  }

  /** Releases all leases across all upstreams. */
  disposeAll(): void {
    for (const key of Array.from(this.leases.keys())) {
      this.clearLease(key);
    }
  }

  private setLease(upstreamKey: string, lease: AgentLease): void {
    this.clearLease(upstreamKey);
    this.leases.set(upstreamKey, lease);

    const remainingMs = lease.expiresAt - Date.now();
    const timer = setTimeout(() => {
      this.clearLease(upstreamKey);
    }, remainingMs);
    this.timers.set(upstreamKey, timer);
  }

  private clearLease(upstreamKey: string): void {
    this.leases.delete(upstreamKey);
    const timer = this.timers.get(upstreamKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(upstreamKey);
    }
  }
}
