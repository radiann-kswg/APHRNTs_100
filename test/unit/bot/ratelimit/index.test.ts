import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../../../../src/bot/ratelimit/index.js";
import { openDatabase } from "../../../../src/storage/db.js";
import { RateLimitStore } from "../../../../src/storage/rate-limit-store.js";

describe("RateLimiter", () => {
  let db: Database;
  let store: RateLimitStore;
  let limiter: RateLimiter;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new RateLimitStore(db);
    limiter = new RateLimiter(store, 60 * 1000, 3);
  });

  it("allows the first reply", () => {
    const decision = limiter.check("user1", null, new Date("2026-01-01T00:00:00Z"));
    expect(decision.allowed).toBe(true);
    expect(decision.exempt).toBe(false);
  });

  it("blocks a second reply within the cooldown window", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    limiter.recordReply("user1", false, now);
    const decision = limiter.check("user1", null, new Date(now.getTime() + 1000));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cooldown");
  });

  it("allows a reply again once the cooldown has elapsed", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    limiter.recordReply("user1", false, now);
    const decision = limiter.check("user1", null, new Date(now.getTime() + 61 * 1000));
    expect(decision.allowed).toBe(true);
  });

  it("exempts messages sent during an active conversation", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    limiter.recordReply("user1", false, now);
    const lastInteractionAt = new Date(now.getTime() + 1000);
    const decision = limiter.check("user1", lastInteractionAt, new Date(now.getTime() + 2000));
    expect(decision.allowed).toBe(true);
    expect(decision.exempt).toBe(true);
  });

  it("blocks once the global hourly cap is reached", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 3; i++) {
      limiter.recordReply(`user${i}`, false, new Date(now.getTime() + i * 2 * 60 * 1000));
    }
    const decision = limiter.check("userX", null, new Date(now.getTime() + 10 * 60 * 1000));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("global_cap");
  });

  it("does not count exempt replies toward the global cap", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    limiter.recordReply("user1", true, now);
    limiter.recordReply("user1", true, new Date(now.getTime() + 1000));
    limiter.recordReply("user1", true, new Date(now.getTime() + 2000));
    const decision = limiter.check("userX", null, new Date(now.getTime() + 3000));
    expect(decision.allowed).toBe(true);
  });
});
