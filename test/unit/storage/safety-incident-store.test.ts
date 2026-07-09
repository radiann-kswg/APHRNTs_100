import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/storage/db.js";
import { SafetyIncidentStore } from "../../../src/storage/safety-incident-store.js";

describe("SafetyIncidentStore", () => {
  let db: Database;
  let store: SafetyIncidentStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new SafetyIncidentStore(db);
  });

  it("records an incident without throwing, storing only matched terms (not raw message text)", () => {
    expect(() => store.record("user1", ["死にたい"], "misskey")).not.toThrow();

    const row = db.prepare("SELECT * FROM safety_incidents WHERE user_id = ?").get("user1") as
      | { matched_terms: string; channel: string }
      | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row?.matched_terms ?? "[]")).toEqual(["死にたい"]);
    expect(row?.channel).toBe("misskey");
  });
});
