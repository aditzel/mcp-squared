export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class SlidingWindowRateLimiter {
  private readonly requests = new Map<string, number[]>();

  check(
    key: string,
    limitPerMinute: number,
    nowMs = Date.now(),
  ): RateLimitResult {
    const windowStart = nowMs - 60_000;
    const history = this.requests.get(key) ?? [];

    while (history.length > 0 && (history[0] ?? 0) < windowStart) {
      history.shift();
    }

    if (history.length >= limitPerMinute) {
      const oldest = history[0] ?? nowMs;
      const retryAfterMs = Math.max(0, oldest + 60_000 - nowMs);
      this.requests.set(key, history);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs,
      };
    }

    history.push(nowMs);
    this.requests.set(key, history);

    return {
      allowed: true,
      remaining: Math.max(0, limitPerMinute - history.length),
      retryAfterMs: 0,
    };
  }

  reset(): void {
    this.requests.clear();
  }
}
