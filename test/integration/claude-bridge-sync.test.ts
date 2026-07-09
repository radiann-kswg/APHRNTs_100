import type { Database } from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridgeRuntime } from "../../src/bridge/runtime.js";
import { runSync } from "../../src/bridge/sync.js";
import { CheckinStore } from "../../src/storage/checkin-store.js";
import { ClaudeNotesStore } from "../../src/storage/claude-notes-store.js";
import { openDatabase } from "../../src/storage/db.js";

const NOW = new Date("2026-07-09T12:00:00.000Z");

describe("Claude連携ブリッジ（結合）", () => {
  let db: Database;
  let logsDir: string;
  let digestPath: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    logsDir = mkdtempSync(join(tmpdir(), "aphrnts-bridge-"));
    digestPath = join(logsDir, "bot-digest.md");
  });

  afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true });
  });

  it("runSync imports Claude logs and writes the bot digest", () => {
    writeFileSync(join(logsDir, "2026-07-08.md"), "# 2026-07-08\n\n## 体調・気分\n落ち着いていた。", "utf8");
    new CheckinStore(db).upsert({ userId: "misskey-user", date: "2026-07-09", mood: 7 }, NOW);

    const result = runSync({ db, logsDir, digestPath, now: () => NOW });

    expect(result.import.imported).toBe(1);
    expect(existsSync(digestPath)).toBe(true);
    const digest = readFileSync(digestPath, "utf8");
    expect(digest).toContain("2026-07-09: 気分 7/10");
    // ダイジェスト自体は次回同期でclaude_session_notesへ混入しないこと
    const reimport = runSync({ db, logsDir, digestPath, now: () => NOW });
    expect(new ClaudeNotesStore(db).count()).toBe(1);
    expect(reimport.import.skipped).toBeGreaterThanOrEqual(1);
  });

  it("currentNotesSection reflects recent imported logs only", () => {
    writeFileSync(join(logsDir, "2026-07-08.md"), "直近の記録", "utf8");
    writeFileSync(join(logsDir, "2026-05-01.md"), "古い記録", "utf8");

    const bridge = createBridgeRuntime({ db, logsDir, digestPath, now: () => NOW });
    bridge.syncOnStartup();

    const section = bridge.currentNotesSection();
    expect(section).toContain("直近の記録");
    expect(section).not.toContain("古い記録");
  });

  it("notesSectionFor injects owner logs only into the owner's conversation", () => {
    writeFileSync(join(logsDir, "2026-07-08.md"), "オーナーの個人ログ", "utf8");

    const bridge = createBridgeRuntime({ db, logsDir, digestPath, ownerUserId: "owner-id", now: () => NOW });
    bridge.syncOnStartup();

    expect(bridge.notesSectionFor("owner-id")).toContain("オーナーの個人ログ");
    expect(bridge.notesSectionFor("someone-else")).toBeUndefined();
  });

  it("notesSectionFor injects logs for everyone when ownerUserId is unset", () => {
    writeFileSync(join(logsDir, "2026-07-08.md"), "共有ログ", "utf8");

    const bridge = createBridgeRuntime({ db, logsDir, digestPath, now: () => NOW });
    bridge.syncOnStartup();

    expect(bridge.notesSectionFor("anyone")).toContain("共有ログ");
  });

  it("wrapHandler re-imports before handling and exports the digest after handling", async () => {
    const bridge = createBridgeRuntime({ db, logsDir, digestPath, now: () => NOW });
    const checkinStore = new CheckinStore(db);

    // ハンドラー内でBot側の記録が保存されるケースを模擬する
    const handler = async () => {
      checkinStore.upsert({ userId: "misskey-user", date: "2026-07-09", mood: 4 }, NOW);
      return { replyText: "了解だ、センパイ。", suppressed: false };
    };

    writeFileSync(join(logsDir, "2026-07-09.md"), "Claude側の当日記録", "utf8");
    const wrapped = bridge.wrapHandler(handler);
    const result = await wrapped("misskey-user", "気分は4くらい", "misskey");

    expect(result.replyText).toContain("センパイ");
    // 処理前importが効いている
    expect(bridge.currentNotesSection()).toContain("Claude側の当日記録");
    // 処理後exportが効いている
    expect(readFileSync(digestPath, "utf8")).toContain("2026-07-09: 気分 4/10");
  });
});
