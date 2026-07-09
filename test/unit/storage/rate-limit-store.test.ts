import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { RateLimitStore } from "../../../src/storage/rate-limit-store.js";

describe("RateLimitStore", () => {
  let db: Database;
  let store: RateLimitStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new RateLimitStore(db);
  });

  it("returns null for a user with no recorded reply", () => {
    expect(store.getLastReplyAt("user1")).toBeNull();
  });

  it("records and retrieves the last reply time", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    store.recordReply("user1", now);
    expect(store.getLastReplyAt("user1")?.toISOString()).toBe(now.toISOString());
  });

  it("counts global posts within a time window", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    store.recordGlobalPost(now);
    store.recordGlobalPost(new Date(now.getTime() + 1000));
    expect(store.countGlobalPostsSince(now.toISOString())).toBe(2);
    expect(store.countGlobalPostsSince(new Date(now.getTime() + 2000).toISOString())).toBe(0);
  });

  it("prunes global posts before a given time", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    store.recordGlobalPost(now);
    store.pruneGlobalPostsBefore(new Date(now.getTime() + 1000).toISOString());
    expect(store.countGlobalPostsSince(new Date(0).toISOString())).toBe(0);
  });
});
