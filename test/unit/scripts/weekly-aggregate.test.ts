import { describe, expect, it } from "vitest";
// スクリプト側の集計ロジック（.mjs）を直接テストする。
// tsconfig の typecheck 対象は src/ のみなので、型宣言なしの .mjs importでよい。
// @ts-expect-error -- .mjs モジュールに型宣言はない
import {
  aggregateWeek,
  buildWeeklySummaryMarkdown,
  parseDailyLogForWeekly,
  shiftDateString,
  weekRangeFor,
} from "../../../scripts/lib/weekly-aggregate.mjs";

const SAMPLE_LOG = `# 2026-07-18（土）

## 服薬

<!-- health-sheet:meds:start -->
- 朝🌄: [x] 済 ／ 日中☀️: [ ] ／ 夜🌙: [x] 済
- 発作時⚡: 2回・頭痛時
<!-- health-sheet:meds:end -->

## 体調・気分

<!-- health-sheet:mood:start -->
気分: 7/10

- エネルギー 4/10。
<!-- health-sheet:mood:end -->

## 睡眠・生活習慣

- 👁‍🗨 起床時刻: 6:00 ／ 💤 入眠時刻: 21:30ごろ
- 眠りの質: 4/5

## 思考記録（モヤモヤがあった日だけ）

<!-- health-sheet:tr:start -->
- 状況: テスト用の思考記録。
<!-- health-sheet:tr:end -->

<!-- creative-log:start -->
## 創作活動の進捗

- テスト用の進捗。
<!-- creative-log:end -->
`;

describe("parseDailyLogForWeekly", () => {
  it("気分・エネルギー・眠りの質・起床時刻・服薬・セクション有無を読み取る", () => {
    const parsed = parseDailyLogForWeekly(SAMPLE_LOG);
    expect(parsed.mood).toBe(7);
    expect(parsed.energy).toBe(4);
    expect(parsed.sleepQuality).toBe(4);
    expect(parsed.wakeTime).toBe("6:00");
    expect(parsed.meds).toEqual({ morning: true, midday: false, night: true });
    expect(parsed.prnCount).toBe(2);
    expect(parsed.hasThoughtRecord).toBe(true);
    expect(parsed.hasCreative).toBe(true);
    expect(parsed.hasGratitude).toBe(false);
    expect(parsed.hasActivation).toBe(false);
  });

  it("項目が無いログでは undefined / false を返す（値を捏造しない）", () => {
    const parsed = parseDailyLogForWeekly("# 2026-07-01\n\n## 体調・気分\n\n- 特に記録なし\n");
    expect(parsed.mood).toBeUndefined();
    expect(parsed.energy).toBeUndefined();
    expect(parsed.sleepQuality).toBeUndefined();
    expect(parsed.wakeTime).toBeUndefined();
    expect(parsed.meds).toEqual({});
    expect(parsed.prnCount).toBeUndefined();
    expect(parsed.hasThoughtRecord).toBe(false);
  });

  it("マーカーコメントしか無いセクションは「記録なし」として扱う", () => {
    const md = "# 2026-07-01\n\n## 思考記録\n\n<!-- health-sheet:tr:start -->\n<!-- health-sheet:tr:end -->\n";
    expect(parseDailyLogForWeekly(md).hasThoughtRecord).toBe(false);
  });

  it("全角数字・全角スラッシュの表記ゆれも読み取れる", () => {
    const parsed = parseDailyLogForWeekly("気分: ７／10\n");
    expect(parsed.mood).toBe(7);
  });
});

describe("weekRangeFor / shiftDateString", () => {
  it("水曜日を渡すと、その週の日曜〜土曜を返す", () => {
    const range = weekRangeFor("2026-07-15"); // 水曜
    expect(range.start).toBe("2026-07-12"); // 日曜
    expect(range.end).toBe("2026-07-18"); // 土曜
    expect(range.dates).toHaveLength(7);
    expect(range.dates[0]).toBe("2026-07-12");
    expect(range.dates[6]).toBe("2026-07-18");
  });

  it("日曜日・土曜日を渡しても同じ週になる", () => {
    expect(weekRangeFor("2026-07-12").start).toBe("2026-07-12");
    expect(weekRangeFor("2026-07-18").start).toBe("2026-07-12");
  });

  it("月末・年末をまたぐ週も正しく計算する", () => {
    const range = weekRangeFor("2026-01-01"); // 木曜
    expect(range.start).toBe("2025-12-28");
    expect(range.end).toBe("2026-01-03");
    expect(shiftDateString("2026-02-28", 1)).toBe("2026-03-01"); // 2026年は平年
  });
});

describe("aggregateWeek", () => {
  function day(date: string, overrides: Record<string, unknown> | null) {
    if (overrides === null) return { date, parsed: null };
    return {
      date,
      parsed: {
        mood: undefined,
        energy: undefined,
        sleepQuality: undefined,
        wakeTime: undefined,
        meds: {},
        prnCount: undefined,
        hasThoughtRecord: false,
        hasGratitude: false,
        hasActivation: false,
        hasCreative: false,
        ...overrides,
      },
    };
  }

  it("気分の平均/最低/最高・服薬達成率・記録日数を集計する", () => {
    const days = [
      day("2026-07-12", { mood: 6, meds: { morning: true, night: true } }),
      day("2026-07-13", { mood: 2, meds: { morning: true, night: false } }),
      day("2026-07-14", { mood: 7, prnCount: 2 }),
      day("2026-07-15", null),
      day("2026-07-16", { hasThoughtRecord: true }),
      day("2026-07-17", null),
      day("2026-07-18", null),
    ];
    const agg = aggregateWeek(days);
    expect(agg.recordedDays).toBe(4);
    expect(agg.mood).toEqual({ avg: 5, min: 2, max: 7, count: 3 });
    // 分母は報告があった日のみ: 朝=2/2、夜=1/2、未報告スロットは0/0
    expect(agg.meds.morning).toEqual({ taken: 2, reported: 2 });
    expect(agg.meds.night).toEqual({ taken: 1, reported: 2 });
    expect(agg.meds.midday).toEqual({ taken: 0, reported: 0 });
    expect(agg.prnTotal).toBe(2);
    expect(agg.thoughtRecordDays).toBe(1);
  });

  it("平均は小数1桁へ丸める", () => {
    const days = [
      day("2026-07-12", { mood: 7 }),
      day("2026-07-13", { mood: 6 }),
      day("2026-07-14", { mood: 6 }),
    ];
    expect(aggregateWeek(days).mood?.avg).toBe(6.3);
  });

  it("記録が1日も無い週は recordedDays=0・各統計は undefined", () => {
    const days = Array.from({ length: 7 }, (_, i) => day(`2026-07-${12 + i}`, null));
    const agg = aggregateWeek(days);
    expect(agg.recordedDays).toBe(0);
    expect(agg.mood).toBeUndefined();
  });
});

describe("buildWeeklySummaryMarkdown", () => {
  it("週間サマリーのMarkdown（傾向・日ごとの一覧表）を組み立てる", () => {
    const range = weekRangeFor("2026-07-15");
    const days = range.dates.map((date: string) =>
      date === "2026-07-18"
        ? { date, parsed: parseDailyLogForWeekly(SAMPLE_LOG) }
        : { date, parsed: null },
    );
    const md = buildWeeklySummaryMarkdown(range, days, aggregateWeek(days));
    expect(md).toContain("## 週間の傾向（機械集計）");
    expect(md).toContain("記録のある日: 1/7日");
    expect(md).toContain("| 07-18（土） | 7 | 4 | 4 | 6:00 | ☑ | ☐ | — | ☑ |");
    expect(md).toContain("記録なし");
    expect(md).toContain("思考記録 1日");
  });
});
