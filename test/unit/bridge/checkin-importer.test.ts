import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importCheckinFromLogs, parseCheckinLog } from "../../../src/bridge/checkin-importer.js";
import { CheckinStore } from "../../../src/storage/checkin-store.js";
import { openDatabase } from "../../../src/storage/db.js";

const NOW = new Date("2026-07-17T12:00:00+09:00");

/** 気分・エネルギー・眠りの質を含む1日分のログを組み立てる */
function checkinDoc(opts: { mood?: string; energy?: string; sleep?: string } = {}): string {
  return [
    "# 2026-07-17（金）",
    "",
    "## 体調・気分",
    "",
    opts.mood ?? "気分: 6/10",
    "",
    `- 👤 身体的な体調: ${opts.energy ?? "エネルギー６/10"}`,
    "",
    "## 睡眠・生活習慣",
    "",
    `- 💤 入眠: 22:30・${opts.sleep ?? "眠りの質 4（Health Sheet 5段階基準）"}`,
  ].join("\n");
}

describe("parseCheckinLog", () => {
  it("reads mood, energy (full-width digits) and sleep quality", () => {
    expect(parseCheckinLog(checkinDoc())).toEqual({ mood: 6, energy: 6, sleepQuality: 4 });
  });

  it("accepts full-width colon and 活力 as energy label", () => {
    expect(parseCheckinLog(checkinDoc({ energy: "エネルギー：８/10" }))).toMatchObject({ energy: 8 });
    expect(parseCheckinLog(checkinDoc({ energy: "活力 7/10" }))).toMatchObject({ energy: 7 });
  });

  it("does not grab energy written in prose without /10", () => {
    const parsed = parseCheckinLog(checkinDoc({ energy: "夕方にエネルギーが1まで低下した" }));
    expect(parsed.energy).toBeUndefined();
  });

  it("does not grab 眠りの質 when no number follows", () => {
    const parsed = parseCheckinLog(checkinDoc({ sleep: "眠りの質が低かった" }));
    expect(parsed.sleepQuality).toBeUndefined();
  });

  it("rejects out-of-range scores", () => {
    expect(parseCheckinLog(checkinDoc({ mood: "気分: 12/10" })).mood).toBeUndefined();
    expect(parseCheckinLog(checkinDoc({ sleep: "眠りの質 9" })).sleepQuality).toBeUndefined();
  });

  it("returns empty when nothing numeric is present", () => {
    expect(parseCheckinLog("# 2026-07-17\n\n## 体調・気分\n\n- なんとなく穏やかだった")).toEqual({});
  });
});

describe("importCheckinFromLogs", () => {
  let db: Database;
  let store: CheckinStore;
  let logsDir: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new CheckinStore(db);
    logsDir = mkdtempSync(join(tmpdir(), "checkin-import-"));
  });

  afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true });
    db.close();
  });

  it("fills empty checkin fields from the log for the owner", () => {
    writeFileSync(join(logsDir, "2026-07-17.md"), checkinDoc());

    const result = importCheckinFromLogs(logsDir, store, "owner1", NOW);

    expect(result.merged).toBe(1);
    const row = store.get("owner1", "2026-07-17");
    expect(row?.mood).toBe(6);
    expect(row?.energy).toBe(6);
    expect(row?.sleep_quality).toBe(4);
  });

  it("is non-destructive: never overwrites values already reported to the bot", () => {
    // Misskeyで気分3・眠りの質5だけ報告済み（エネルギーは未報告）
    store.upsert({ userId: "owner1", date: "2026-07-17", mood: 3, sleepQuality: 5 }, NOW);
    writeFileSync(join(logsDir, "2026-07-17.md"), checkinDoc({ mood: "気分: 6/10", energy: "エネルギー 5/10" }));

    const result = importCheckinFromLogs(logsDir, store, "owner1", NOW);

    expect(result.merged).toBe(1);
    const row = store.get("owner1", "2026-07-17");
    expect(row?.mood).toBe(3); // Bot側の値を保持
    expect(row?.sleep_quality).toBe(5); // Bot側の値を保持
    expect(row?.energy).toBe(5); // 空いていたエネルギーだけ補完
  });

  it("is idempotent and only counts days it actually fills", () => {
    writeFileSync(join(logsDir, "2026-07-17.md"), checkinDoc());

    expect(importCheckinFromLogs(logsDir, store, "owner1", NOW).merged).toBe(1);
    // 2回目は全項目が埋まっているので何もしない
    expect(importCheckinFromLogs(logsDir, store, "owner1", NOW).merged).toBe(0);
    expect(store.listSince("owner1", "2000-01-01")).toHaveLength(1);
  });

  it("skips non-date files (README / bot-digest)", () => {
    writeFileSync(join(logsDir, "README.md"), checkinDoc());
    writeFileSync(join(logsDir, "bot-digest.md"), checkinDoc());

    expect(importCheckinFromLogs(logsDir, store, "owner1", NOW).merged).toBe(0);
    expect(store.listSince("owner1", "2000-01-01")).toHaveLength(0);
  });

  it("does nothing when ownerUserId is empty or logsDir does not exist", () => {
    writeFileSync(join(logsDir, "2026-07-17.md"), checkinDoc());

    expect(importCheckinFromLogs(logsDir, store, "", NOW).merged).toBe(0);
    expect(importCheckinFromLogs(join(logsDir, "missing"), store, "owner1", NOW).merged).toBe(0);
  });
});
