import { describe, expect, it } from "vitest";
import {
  computeBackoffDelay,
  DEFAULT_KEEPALIVE_OPTIONS,
  isShortLivedConnection,
  resolveKeepaliveOptions,
  type BackoffOptions,
} from "../../../src/misskey/reconnect-policy.js";

const backoff: BackoffOptions = { baseMs: 1000, factor: 2, maxMs: 30000, jitterRatio: 0 };

describe("computeBackoffDelay", () => {
  it("grows exponentially from the base delay", () => {
    expect(computeBackoffDelay(0, backoff, 0.5)).toBe(1000);
    expect(computeBackoffDelay(1, backoff, 0.5)).toBe(2000);
    expect(computeBackoffDelay(2, backoff, 0.5)).toBe(4000);
    expect(computeBackoffDelay(3, backoff, 0.5)).toBe(8000);
  });

  it("caps the delay at maxMs", () => {
    // 1000 * 2^6 = 64000 だが上限30000で頭打ち
    expect(computeBackoffDelay(6, backoff, 0.5)).toBe(30000);
    expect(computeBackoffDelay(100, backoff, 0.5)).toBe(30000);
  });

  it("clamps negative attempts to zero", () => {
    expect(computeBackoffDelay(-5, backoff, 0.5)).toBe(1000);
  });

  it("applies symmetric jitter based on the random value", () => {
    const jittered: BackoffOptions = { baseMs: 1000, factor: 2, maxMs: 30000, jitterRatio: 0.2 };
    // random=0 → -20%、random=1 → +20%、random=0.5 → ±0
    expect(computeBackoffDelay(0, jittered, 0)).toBe(800);
    expect(computeBackoffDelay(0, jittered, 1)).toBe(1200);
    expect(computeBackoffDelay(0, jittered, 0.5)).toBe(1000);
  });

  it("keeps the jittered delay within the cap-derived band and non-negative", () => {
    const jittered: BackoffOptions = { baseMs: 1000, factor: 2, maxMs: 30000, jitterRatio: 0.2 };
    for (let attempt = 0; attempt <= 10; attempt++) {
      for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
        const delay = computeBackoffDelay(attempt, jittered, random);
        expect(delay).toBeGreaterThanOrEqual(0);
        // 上限30000に対し+20%までは許容範囲
        expect(delay).toBeLessThanOrEqual(30000 * 1.2);
      }
    }
  });
});

describe("isShortLivedConnection", () => {
  it("treats a never-connected stream as short-lived", () => {
    expect(isShortLivedConnection(null, 12345, 60000)).toBe(true);
  });

  it("returns true when the connection lasted less than stabilityMs", () => {
    expect(isShortLivedConnection(0, 59999, 60000)).toBe(true);
  });

  it("returns false when the connection lasted at least stabilityMs", () => {
    expect(isShortLivedConnection(0, 60000, 60000)).toBe(false);
    expect(isShortLivedConnection(1000, 120000, 60000)).toBe(false);
  });
});

describe("resolveKeepaliveOptions", () => {
  it("returns the defaults when nothing is overridden", () => {
    expect(resolveKeepaliveOptions()).toEqual(DEFAULT_KEEPALIVE_OPTIONS);
  });

  it("overrides only the provided top-level fields", () => {
    const resolved = resolveKeepaliveOptions({ pingIntervalMs: 5000 });
    expect(resolved.pingIntervalMs).toBe(5000);
    expect(resolved.stabilityMs).toBe(DEFAULT_KEEPALIVE_OPTIONS.stabilityMs);
    expect(resolved.backoff).toEqual(DEFAULT_KEEPALIVE_OPTIONS.backoff);
  });

  it("merges a partial backoff override without dropping the other backoff fields", () => {
    const resolved = resolveKeepaliveOptions({ backoff: { maxMs: 10000 } });
    expect(resolved.backoff.maxMs).toBe(10000);
    expect(resolved.backoff.baseMs).toBe(DEFAULT_KEEPALIVE_OPTIONS.backoff.baseMs);
    expect(resolved.backoff.factor).toBe(DEFAULT_KEEPALIVE_OPTIONS.backoff.factor);
    expect(resolved.backoff.jitterRatio).toBe(DEFAULT_KEEPALIVE_OPTIONS.backoff.jitterRatio);
  });
});
