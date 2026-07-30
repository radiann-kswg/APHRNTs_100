import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importCreativeLogsFromLogs, parseCreativeLog } from "../../../src/bridge/creative-log-importer.js";
import { CreativeLogStore } from "../../../src/storage/creative-log-store.js";
import { openDatabase } from "../../../src/storage/db.js";

const OWNER = "owner1";
const NOW = new Date("2026-07-20T12:00:00+09:00");

const CREATIVE_LOG = [
  "# 2026-07-19（日）",
  "",
  "## 体調・気分",
  "",
  "気分: 5/10",
  "",
  "<!-- creative-log:start -->",
  "## 創作活動の進捗",
  "",
  "- ローカル4局の定時議事録を更新した。",
  "- Dropboxバックアップを実行した。",
  "",
  "## 取り組んだタスク",
  "",
  "- Driveミラー同期点検を実施した。",
  "<!-- creative-log:end -->",
].join("\n");

describe("parseCreativeLog", () => {
  it("creative-logマーカー区間から進捗とタスクを読み取る", () => {
    const parsed = parseCreativeLog(CREATIVE_LOG);
    expect(parsed.progress).toContain("定時議事録を更新した");
    expect(parsed.progress).toContain("Dropboxバックアップ");
    expect(parsed.tasks).toContain("Driveミラー同期点検");
    // マーカー外のセクション（体調・気分）は含まない
    expect(parsed.progress).not.toContain("気分");
  });

  it("マーカーが無い過去ログでも見出しから読み取れる", () => {
    const md = "# 2026-07-01\n\n## 創作活動の進捗\n\n- 旧形式の進捗\n\n## 100(モモ)からのひとこと\n\n- メモ";
    const parsed = parseCreativeLog(md);
    expect(parsed.progress).toBe("- 旧形式の進捗");
    expect(parsed.tasks).toBeUndefined();
  });

  it("どちらのセクションも無ければ空のオブジェクト", () => {
    expect(parseCreativeLog("# 2026-07-01\n\n## 体調・気分\n\n気分: 7/10")).toEqual({});
  });
});

describe("importCreativeLogsFromLogs", () => {
  let db: Database;
  let store: CreativeLogStore;
  let logsDir: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    store = new CreativeLogStore(db);
    logsDir = mkdtempSync(join(tmpdir(), "creative-importer-"));
  });

  afterEach(() => {
    db.close();
    rmSync(logsDir, { recursive: true, force: true });
  });

  it("creative-log区間のある日を creative_logs へ取り込む", () => {
    writeFileSync(join(logsDir, "2026-07-19.md"), CREATIVE_LOG);

    const result = importCreativeLogsFromLogs(logsDir, store, OWNER, NOW);

    expect(result.merged).toBe(1);
    const row = store.get(OWNER, "2026-07-19");
    expect(row?.progress).toContain("定時議事録");
    expect(row?.tasks).toContain("Driveミラー同期点検");
  });

  it("冪等: 内容が変わらない日は再実行しても merged に数えない", () => {
    writeFileSync(join(logsDir, "2026-07-19.md"), CREATIVE_LOG);

    importCreativeLogsFromLogs(logsDir, store, OWNER, NOW);
    const second = importCreativeLogsFromLogs(logsDir, store, OWNER, NOW);

    expect(second.merged).toBe(0);
  });

  it("Claude側の内容が更新されたら上書きで反映する（Claude側が正）", () => {
    writeFileSync(join(logsDir, "2026-07-19.md"), CREATIVE_LOG);
    importCreativeLogsFromLogs(logsDir, store, OWNER, NOW);

    writeFileSync(
      join(logsDir, "2026-07-19.md"),
      CREATIVE_LOG.replace("- Driveミラー同期点検を実施した。", "- Driveミラー同期点検を実施した。\n- 追記のタスク。"),
    );
    const result = importCreativeLogsFromLogs(logsDir, store, OWNER, NOW);

    expect(result.merged).toBe(1);
    expect(store.get(OWNER, "2026-07-19")?.tasks).toContain("追記のタスク");
  });

  it("bot-digest.md 等の対象外ファイルと、区間の無い日はスキップする", () => {
    writeFileSync(join(logsDir, "bot-digest.md"), CREATIVE_LOG);
    writeFileSync(join(logsDir, "2026-07-18.md"), "# 2026-07-18\n\n## 体調・気分\n\n気分: 2/10");

    const result = importCreativeLogsFromLogs(logsDir, store, OWNER, NOW);

    expect(result.merged).toBe(0);
  });

  it("ownerUserIdが空のときは何もしない", () => {
    writeFileSync(join(logsDir, "2026-07-19.md"), CREATIVE_LOG);
    expect(importCreativeLogsFromLogs(logsDir, store, "", NOW).merged).toBe(0);
  });
});
