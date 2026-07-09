import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { SessionStore } from "../../../src/storage/session-store.js";

describe("SessionStore", () => {
  let db: Database;
  let store: SessionStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new SessionStore(db);
  });

  it("returns an empty history for unknown users", () => {
    expect(store.getHistory("nobody")).toEqual([]);
  });

  it("appends and retrieves an exchange", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    store.appendExchange("user1", "こんにちは", "やあセンパイ", now);
    const history = store.getHistory("user1", now);
    expect(history).toEqual([
      { role: "user", content: "こんにちは" },
      { role: "assistant", content: "やあセンパイ" },
    ]);
  });

  it("expires history after the TTL", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    store.appendExchange("user1", "hi", "hello", now);
    const later = new Date(now.getTime() + 31 * 60 * 1000);
    expect(store.getHistory("user1", later)).toEqual([]);
  });

  it("clears history on demand", () => {
    const now = new Date();
    store.appendExchange("user1", "hi", "hello", now);
    store.clear("user1");
    expect(store.getHistory("user1")).toEqual([]);
  });

  it("lists known user ids", () => {
    const now = new Date();
    store.appendExchange("user1", "hi", "hello", now);
    store.appendExchange("user2", "hi", "hello", now);
    expect(store.listKnownUserIds().sort()).toEqual(["user1", "user2"]);
  });
});
