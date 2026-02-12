import { describe, expect, test } from "bun:test";
import { SlidingWindowRateLimiter } from "../../agent_safety_kit/guard/ratelimit.js";

describe("SlidingWindowRateLimiter", () => {
  test("allows requests within limit", () => {
    const limiter = new SlidingWindowRateLimiter();

    const first = limiter.check("agent:tool:call", 2, 1_000);
    const second = limiter.check("agent:tool:call", 2, 2_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  test("blocks requests exceeding per-minute limit", () => {
    const limiter = new SlidingWindowRateLimiter();

    limiter.check("agent:tool:call", 1, 1_000);
    const blocked = limiter.check("agent:tool:call", 1, 2_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  test("expires events outside the rolling window", () => {
    const limiter = new SlidingWindowRateLimiter();

    limiter.check("agent:tool:call", 1, 1_000);
    const allowedAgain = limiter.check("agent:tool:call", 1, 62_000);

    expect(allowedAgain.allowed).toBe(true);
  });
});
