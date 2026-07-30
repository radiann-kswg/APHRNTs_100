import type { Database } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CreativeLogStore } from "../../../src/storage/creative-log-store.js";
import { openDatabase } from "../../../src/storage/db.js";

const NOW = new Date("2026-07-20T12:00:00+09:00");

describe("CreativeLogStore", () => {
  let db: Database;
  let store: CreativeLogStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new CreativeLogStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("upsertで作成し、getで取得できる", () => {
    const row = store.upsert({ userId: "u1", date: "2026-07-19", progress: "- 進捗A", tasks: "- タスクA" }, NOW);
    expect(row.progress).toBe("- 進捗A");
    expect(row.tasks).toBe("- タスクA");
    expect(store.get("u1", "2026-07-19")?.id).toBe(row.id);
  });

  it("同じ日付へのupsertは上書きになる（重複行を作らない）", () => {
    store.upsert({ userId: "u1", date: "2026-07-19", progress: "- 旧" }, NOW);
    const updated = store.upsert({ userId: "u1", date: "2026-07-19", progress: "- 新", tasks: "- 追加" }, NOW);
    expect(updated.progress).toBe("- 新");
    expect(updated.tasks).toBe("- 追加");
    expect(store.listSince("u1", "2026-07-01")).toHaveLength(1);
  });

  it("listSinceは指定日以降を日付昇順で返し、ユーザーを混同しない", () => {
    store.upsert({ userId: "u1", date: "2026-07-19", progress: "- A" }, NOW);
    store.upsert({ userId: "u1", date: "2026-07-13", progress: "- B" }, NOW);
    store.upsert({ userId: "u2", date: "2026-07-19", progress: "- 他人" }, NOW);

    const rows = store.listSince("u1", "2026-07-14");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.progress).toBe("- A");
  });
});
