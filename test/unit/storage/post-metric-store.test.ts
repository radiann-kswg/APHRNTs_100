import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { DailyPostMetrics } from "../../../src/analysis/post-metrics.js";
import { openDatabase } from "../../../src/storage/db.js";
import { PostMetricStore } from "../../../src/storage/post-metric-store.js";

function metrics(overrides: Partial<DailyPostMetrics> = {}): DailyPostMetrics {
  return {
    date: "2026-09-16",
    postCount: 3,
    replyCount: 1,
    nightPostCount: 1,
    firstPostAt: "2026-09-16T01:00:00.000Z",
    lastPostAt: "2026-09-16T10:00:00.000Z",
    totalChars: 120,
    cwCount: 1,
    attachmentPostCount: 1,
    maxBurstPerHour: 2,
    ...overrides,
  };
}

describe("PostMetricStore", () => {
  let db: Database;
  let store: PostMetricStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new PostMetricStore(db);
  });

  it("merges a later batch of the same day additively instead of overwriting", () => {
    store.addDaily("owner1", metrics());
    store.addDaily(
      "owner1",
      metrics({
        postCount: 2,
        replyCount: 0,
        nightPostCount: 0,
        totalChars: 30,
        cwCount: 0,
        attachmentPostCount: 0,
        maxBurstPerHour: 1,
        firstPostAt: "2026-09-16T11:00:00.000Z",
        lastPostAt: "2026-09-16T13:00:00.000Z",
      }),
    );

    const [row] = store.listSince("owner1", "2026-09-01");
    expect(row?.post_count).toBe(5);
    expect(row?.reply_count).toBe(1);
    expect(row?.night_post_count).toBe(1);
    expect(row?.total_chars).toBe(150);
    expect(row?.max_burst_per_hour).toBe(2);
    // 最初/最後の投稿時刻は広がる方向にだけ動く
    expect(row?.first_post_at).toBe("2026-09-16T01:00:00.000Z");
    expect(row?.last_post_at).toBe("2026-09-16T13:00:00.000Z");
  });

  it("keeps each user's days separate and returns them in date order", () => {
    store.addDaily("owner1", metrics({ date: "2026-09-15" }));
    store.addDaily("owner1", metrics({ date: "2026-09-16" }));
    store.addDaily("other", metrics({ date: "2026-09-16" }));

    expect(store.listSince("owner1", "2026-09-01").map((row) => row.date)).toEqual(["2026-09-15", "2026-09-16"]);
    expect(store.listSince("owner1", "2026-09-16")).toHaveLength(1);
  });

  it("deletes rows past the retention window, leaving newer days alone", () => {
    store.addDaily("owner1", metrics({ date: "2026-03-01" }));
    store.addDaily("owner1", metrics({ date: "2026-09-16" }));

    expect(store.deleteBefore("owner1", "2026-04-01")).toBe(1);
    expect(store.listSince("owner1", "2000-01-01").map((row) => row.date)).toEqual(["2026-09-16"]);
  });

  it("deletes everything for one user when the feature is switched off", () => {
    store.addDaily("owner1", metrics({ date: "2026-09-15" }));
    store.addDaily("owner1", metrics({ date: "2026-09-16" }));
    store.addDaily("other", metrics({ date: "2026-09-16" }));

    expect(store.deleteAllForUser("owner1")).toBe(2);
    expect(store.listSince("owner1", "2000-01-01")).toEqual([]);
    expect(store.listSince("other", "2000-01-01")).toHaveLength(1);
  });
});
