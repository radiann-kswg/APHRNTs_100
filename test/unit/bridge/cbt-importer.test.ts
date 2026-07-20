import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  importCbtRecordsFromLogs,
  jstDayRange,
  jstNoonOf,
  parseActivationSection,
  parseGratitudeSection,
  parseThoughtRecordSection,
} from "../../../src/bridge/cbt-importer.js";
import { BehavioralActivationStore } from "../../../src/storage/behavioral-activation-store.js";
import { openDatabase } from "../../../src/storage/db.js";
import { GratitudeStore } from "../../../src/storage/gratitude-store.js";
import { ThoughtRecordStore } from "../../../src/storage/thought-record-store.js";

const OWNER = "owner1";

const TR_LOG = [
  "# 2026-07-18（土）",
  "",
  "## 思考記録（モヤモヤがあった日だけ）",
  "",
  "<!-- health-sheet:tr:start -->",
  "- 状況（いつ・どこで・何が）: 16時ごろ、手持ち無沙汰になったタイミングで出現。",
  "- 自動思考（頭に浮かんだ考え）: 「今まで自分は何をやってきたんだろう」",
  "- そのときの気分・強さ（%）: 無力感 70%",
  "- 認知の歪み（あれば・断定しない）: （未確認）",
  "- 根拠（その考えを支える事実）: （未確認）",
  "- 反証（そうとは言い切れない事実）: 同日、数時間集中して作業できていた実績あり。",
  "- バランス思考（両方をふまえた見方）: （未確認・次回対話で整理予定）",
  "- 再評価後の気分（%）: 40%くらいまで下がった",
  "<!-- health-sheet:tr:end -->",
].join("\n");

describe("parseThoughtRecordSection", () => {
  it("ラベル付き箇条書きから各フィールドを読み取り、（未確認）は値なしとして扱う", () => {
    const parsed = parseThoughtRecordSection(TR_LOG);
    expect(parsed).toBeDefined();
    expect(parsed?.situation).toContain("16時ごろ");
    expect(parsed?.automaticThought).toContain("何をやってきたんだろう");
    expect(parsed?.emotionLabel).toBe("無力感");
    expect(parsed?.emotionIntensity).toBe(70);
    expect(parsed?.distortionId).toBeUndefined();
    expect(parsed?.evidenceFor).toBeUndefined();
    expect(parsed?.evidenceAgainst).toContain("集中して作業できていた");
    expect(parsed?.balancedThought).toBeUndefined();
    expect(parsed?.reRatedEmotionIntensity).toBe(40);
  });

  it("セクションが無い・マーカーだけ・全て未確認の場合は undefined", () => {
    expect(parseThoughtRecordSection("# 2026-07-01\n\n## 体調・気分\n\n気分: 7/10")).toBeUndefined();
    expect(
      parseThoughtRecordSection("## 思考記録\n\n<!-- health-sheet:tr:start -->\n<!-- health-sheet:tr:end -->"),
    ).toBeUndefined();
    expect(
      parseThoughtRecordSection("## 思考記録\n\n- 状況: （未確認）\n- 自動思考: （未確認）"),
    ).toBeUndefined();
  });

  it("気分の%が無い場合は全文をラベルとして保持する", () => {
    const parsed = parseThoughtRecordSection("## 思考記録\n\n- 状況: テスト\n- そのときの気分・強さ（%）: 不安が強い");
    expect(parsed?.emotionLabel).toBe("不安が強い");
    expect(parsed?.emotionIntensity).toBeUndefined();
  });
});

describe("parseActivationSection", () => {
  it("箇条書き1行を1活動として読み、予測/実際のスコアと状態を判別する", () => {
    const md = [
      "## 行動活性化",
      "",
      "- 5分だけ散歩する（予測: 楽しさ 4・やり遂げた感 6）",
      "- 好きな曲を1曲聴いた。実際は 楽しさ 7・達成感 5 だった",
    ].join("\n");
    const activities = parseActivationSection(md);
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({ status: "planned", predictedPleasure: 4, predictedMastery: 6 });
    expect(activities[1]).toMatchObject({ status: "completed", actualPleasure: 7, actualMastery: 5 });
  });

  it("セクションが無ければ空配列", () => {
    expect(parseActivationSection("# 2026-07-01\n\n## 体調・気分")).toEqual([]);
  });
});

describe("parseGratitudeSection", () => {
  it("箇条書きを最大3件読み取る", () => {
    const md = "## 感謝日記\n\n- コーヒーが美味しかった\n- 散歩が気持ちよかった\n- よく眠れた\n- 4つ目は無視";
    expect(parseGratitudeSection(md)).toEqual(["コーヒーが美味しかった", "散歩が気持ちよかった", "よく眠れた"]);
  });

  it("セクションが無ければ空配列", () => {
    expect(parseGratitudeSection("# 2026-07-01")).toEqual([]);
  });
});

describe("jstDayRange / jstNoonOf", () => {
  it("JSTの一日ぶんのISO範囲と正午を返す", () => {
    const { fromIso, toIso } = jstDayRange("2026-07-18");
    expect(fromIso).toBe("2026-07-17T15:00:00.000Z");
    expect(toIso).toBe("2026-07-18T15:00:00.000Z");
    expect(jstNoonOf("2026-07-18").toISOString()).toBe("2026-07-18T03:00:00.000Z");
  });
});

describe("importCbtRecordsFromLogs", () => {
  let db: Database;
  let stores: {
    thoughtRecordStore: ThoughtRecordStore;
    activationStore: BehavioralActivationStore;
    gratitudeStore: GratitudeStore;
  };
  let logsDir: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    stores = {
      thoughtRecordStore: new ThoughtRecordStore(db),
      activationStore: new BehavioralActivationStore(db),
      gratitudeStore: new GratitudeStore(db),
    };
    logsDir = mkdtempSync(join(tmpdir(), "cbt-importer-"));
  });

  afterEach(() => {
    db.close();
    rmSync(logsDir, { recursive: true, force: true });
  });

  it("Bot側に記録が無い日の思考記録・感謝日記を取り込む（created_atはその日の正午JST）", () => {
    writeFileSync(join(logsDir, "2026-07-18.md"), `${TR_LOG}\n\n## 感謝日記\n\n- 良いことがあった\n`);

    const result = importCbtRecordsFromLogs(logsDir, stores, OWNER);

    expect(result).toEqual({ thoughtRecords: 1, activations: 0, gratitudes: 1 });
    const records = stores.thoughtRecordStore.listSince(OWNER, "2026-07-01T00:00:00.000Z");
    expect(records).toHaveLength(1);
    expect(records[0]?.created_at).toBe("2026-07-18T03:00:00.000Z");
    expect(stores.gratitudeStore.hasAnyOnDate(OWNER, "2026-07-18")).toBe(true);
  });

  it("冪等: 2回実行しても重複して取り込まない", () => {
    writeFileSync(join(logsDir, "2026-07-18.md"), TR_LOG);

    importCbtRecordsFromLogs(logsDir, stores, OWNER);
    const second = importCbtRecordsFromLogs(logsDir, stores, OWNER);

    expect(second).toEqual({ thoughtRecords: 0, activations: 0, gratitudes: 0 });
    expect(stores.thoughtRecordStore.listSince(OWNER, "2026-07-01T00:00:00.000Z")).toHaveLength(1);
  });

  it("非破壊: Bot側に同じ日（JST）の記録が既にあれば取り込まない", () => {
    writeFileSync(join(logsDir, "2026-07-18.md"), TR_LOG);
    // Bot側で7/18のJST日中に save_thought_record 済みの想定
    stores.thoughtRecordStore.create(
      { userId: OWNER, situation: "Bot側の既存記録" },
      new Date("2026-07-18T10:00:00+09:00"),
    );

    const result = importCbtRecordsFromLogs(logsDir, stores, OWNER);

    expect(result.thoughtRecords).toBe(0);
    const records = stores.thoughtRecordStore.listSince(OWNER, "2026-07-01T00:00:00.000Z");
    expect(records).toHaveLength(1);
    expect(records[0]?.situation).toBe("Bot側の既存記録");
  });

  it("ownerUserIdが空のときは何もしない", () => {
    writeFileSync(join(logsDir, "2026-07-18.md"), TR_LOG);
    const result = importCbtRecordsFromLogs(logsDir, stores, "");
    expect(result).toEqual({ thoughtRecords: 0, activations: 0, gratitudes: 0 });
  });
});
