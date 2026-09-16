import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { UserNote } from "../../../src/analysis/post-metrics.js";
import { createPostAnalysisTask, type PostNoteSource } from "../../../src/scheduler/post-analysis-task.js";
import { BotStateStore } from "../../../src/storage/bot-state-store.js";
import { openDatabase } from "../../../src/storage/db.js";
import { PostMetricStore, postAnalysisCursorKey } from "../../../src/storage/post-metric-store.js";
import { UserPreferenceStore } from "../../../src/storage/user-preference-store.js";

const OWNER = "owner1";
// JST 05:00（= UTC 20:00 前日）。日次バッチの既定時刻。
const RUN_AT = new Date("2026-09-16T20:00:00Z");
const SECRET_BODY = "きょうは眠れなくて朝まで起きていた";

function note(overrides: Partial<UserNote> & { id: string; createdAt: string }): UserNote {
  return { userId: OWNER, text: SECRET_BODY, visibility: "public", ...overrides };
}

function createFakeSource(pages: UserNote[]): {
  source: PostNoteSource;
  calls: { userId: string; sinceId?: string | null; maxNotes?: number }[];
} {
  const calls: { userId: string; sinceId?: string | null; maxNotes?: number }[] = [];
  const source: PostNoteSource = {
    fetchUserNotes: async (userId, options) => {
      calls.push({ userId, ...options });
      return pages;
    },
  };
  return { source, calls };
}

describe("createPostAnalysisTask", () => {
  let db: Database;
  let botStateStore: BotStateStore;
  let preferenceStore: UserPreferenceStore;
  let postMetricStore: PostMetricStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    botStateStore = new BotStateStore(db);
    preferenceStore = new UserPreferenceStore(db);
    postMetricStore = new PostMetricStore(db);
  });

  function createTask(source: PostNoteSource, overrides: Partial<Parameters<typeof createPostAnalysisTask>[0]> = {}) {
    return createPostAnalysisTask({
      botStateStore,
      preferenceStore,
      postMetricStore,
      noteSource: source,
      ownerUserId: OWNER,
      hour: 5,
      maxNotesPerRun: 500,
      visibilities: ["public", "home"],
      retentionDays: 180,
      ...overrides,
    });
  }

  it("does not fetch a single note while the preference is off (opt-in, default off)", async () => {
    const { source, calls } = createFakeSource([note({ id: "n1", createdAt: "2026-09-16T01:00:00Z" })]);
    await createTask(source).run(RUN_AT);
    expect(calls).toEqual([]);
    expect(postMetricStore.listSince(OWNER, "2000-01-01")).toEqual([]);
  });

  it("does not fetch when the owner user id is unknown, even with the preference on", async () => {
    preferenceStore.setPostAnalysisEnabled(OWNER, true);
    const { source, calls } = createFakeSource([note({ id: "n1", createdAt: "2026-09-16T01:00:00Z" })]);
    await createTask(source, { ownerUserId: "" }).run(RUN_AT);
    expect(calls).toEqual([]);
  });

  it("does not run outside the configured hour", async () => {
    preferenceStore.setPostAnalysisEnabled(OWNER, true);
    const { source, calls } = createFakeSource([note({ id: "n1", createdAt: "2026-09-16T01:00:00Z" })]);
    // UTC 20:00 は JST 05:00。hour=6 の枠では発火しない
    await createTask(source, { hour: 6 }).run(RUN_AT);
    expect(calls).toEqual([]);
  });

  it("aggregates the owner's notes and advances the cursor past every fetched note", async () => {
    preferenceStore.setPostAnalysisEnabled(OWNER, true);
    const { source, calls } = createFakeSource([
      note({ id: "n1", createdAt: "2026-09-16T01:00:00Z" }),
      note({ id: "n2", createdAt: "2026-09-16T02:00:00Z" }),
      // 集計対象外（他人の投稿・チャンネル投稿）でもカーソルは進める
      note({ id: "n3", createdAt: "2026-09-16T03:00:00Z", userId: "someone-else" }),
      note({ id: "n4", createdAt: "2026-09-16T04:00:00Z", channelId: "ch1" }),
    ]);

    await createTask(source).run(RUN_AT);

    expect(calls).toEqual([{ userId: OWNER, sinceId: null, maxNotes: 500 }]);
    const rows = postMetricStore.listSince(OWNER, "2000-01-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe("2026-09-16");
    expect(rows[0]?.post_count).toBe(2);
    expect(botStateStore.get(postAnalysisCursorKey(OWNER))).toBe("n4");
  });

  it("stores no note text anywhere in the database", async () => {
    preferenceStore.setPostAnalysisEnabled(OWNER, true);
    const { source } = createFakeSource([
      note({ id: "n1", createdAt: "2026-09-16T01:00:00Z", cw: "ぐち" }),
      note({ id: "n2", createdAt: "2026-09-16T02:00:00Z", text: `${SECRET_BODY}2` }),
    ]);

    await createTask(source).run(RUN_AT);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const dump = tables
      .map((table) => JSON.stringify(db.prepare(`SELECT * FROM "${table.name}"`).all()))
      .join("\n");
    expect(dump).not.toContain(SECRET_BODY);
    expect(dump).not.toContain("ぐち");
  });

  it("resumes from the stored cursor and does not double count on a later run", async () => {
    preferenceStore.setPostAnalysisEnabled(OWNER, true);
    const { source: firstSource } = createFakeSource([note({ id: "n1", createdAt: "2026-09-16T01:00:00Z" })]);
    await createTask(firstSource).run(RUN_AT);

    // 翌日の実行: カーソル以降の新着だけが来る（同じノートは二度と返らない）
    const nextDay = new Date("2026-09-17T20:00:00Z");
    const { source: secondSource, calls } = createFakeSource([note({ id: "n2", createdAt: "2026-09-17T02:00:00Z" })]);
    await createTask(secondSource).run(nextDay);

    expect(calls[0]?.sinceId).toBe("n1");
    const rows = postMetricStore.listSince(OWNER, "2000-01-01");
    expect(rows.map((row) => [row.date, row.post_count])).toEqual([
      ["2026-09-16", 1],
      ["2026-09-17", 1],
    ]);
  });

  it("skips a second run on the same day (no double counting from the 5-minute polling)", async () => {
    preferenceStore.setPostAnalysisEnabled(OWNER, true);
    const { source, calls } = createFakeSource([note({ id: "n1", createdAt: "2026-09-16T01:00:00Z" })]);
    const task = createTask(source);

    await task.run(RUN_AT);
    await task.run(new Date(RUN_AT.getTime() + 5 * 60 * 1000));

    expect(calls).toHaveLength(1);
    expect(postMetricStore.listSince(OWNER, "2000-01-01")[0]?.post_count).toBe(1);
  });

  it("drops metrics older than the retention window", async () => {
    preferenceStore.setPostAnalysisEnabled(OWNER, true);
    postMetricStore.addDaily(OWNER, {
      date: "2026-01-01",
      postCount: 5,
      replyCount: 0,
      nightPostCount: 0,
      firstPostAt: null,
      lastPostAt: null,
      totalChars: 0,
      cwCount: 0,
      attachmentPostCount: 0,
      maxBurstPerHour: 0,
    });
    const { source } = createFakeSource([]);

    await createTask(source, { retentionDays: 30 }).run(RUN_AT);

    expect(postMetricStore.listSince(OWNER, "2000-01-01")).toEqual([]);
  });
});
