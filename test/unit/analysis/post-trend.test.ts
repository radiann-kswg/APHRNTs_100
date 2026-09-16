import { describe, expect, it } from "vitest";
import { summarizePostTrend } from "../../../src/analysis/post-trend.js";
import type { PostMetricRow } from "../../../src/storage/post-metric-store.js";

/** 出力に混ぜてはいけない語（診断・評価・合成スコアを作らないための回帰テスト） */
const FORBIDDEN_TERMS = ["診断", "症状", "うつ", "病", "障害", "スコア", "ダメ", "頑張"];

function row(date: string, overrides: Partial<PostMetricRow> = {}): PostMetricRow {
  return {
    id: 0,
    user_id: "owner1",
    date,
    post_count: 4,
    reply_count: 1,
    night_post_count: 1,
    first_post_at: `${date}T00:00:00.000Z`,
    last_post_at: `${date}T12:34:00.000Z`,
    total_chars: 200,
    cw_count: 0,
    attachment_post_count: 0,
    max_burst_per_hour: 2,
    created_at: `${date}T13:00:00.000Z`,
    updated_at: `${date}T13:00:00.000Z`,
    ...overrides,
  };
}

describe("summarizePostTrend", () => {
  it("reports raw counts with the baseline, and never a single composite score", () => {
    const rows = [
      // 平常時（直近7日より前の28日間）: 1日8件
      row("2026-08-20", { post_count: 8, total_chars: 400 }),
      row("2026-08-21", { post_count: 8, total_chars: 400 }),
      // 直近7日: 合計6件
      row("2026-09-14", { post_count: 4, total_chars: 100 }),
      row("2026-09-16", { post_count: 2, total_chars: 50 }),
    ];
    const summary = summarizePostTrend(rows, { days: 7, today: "2026-09-16" });

    expect(summary).toContain("直近7日（2026-09-10〜2026-09-16, JST）");
    expect(summary).toContain("合計6件");
    expect(summary).toContain("投稿のあった日: 7日のうち2日");
    expect(summary).toContain("その前の28日間は");
    for (const term of FORBIDDEN_TERMS) {
      expect(summary).not.toContain(term);
    }
  });

  it("always says the numbers only cover what the Bot can see, and leaves the reading to the user", () => {
    const summary = summarizePostTrend([row("2026-09-16")], { days: 7, today: "2026-09-16" });
    expect(summary).toContain("Botから見えている範囲");
    expect(summary).toContain("本文は保存してない");
    expect(summary).toContain("センパイ自身の実感");
  });

  it("says so plainly when there is nothing to compare against yet", () => {
    const summary = summarizePostTrend([row("2026-09-16")], { days: 7, today: "2026-09-16" });
    expect(summary).toContain("比較できる前の期間の記録はまだ無い");
  });

  it("counts the silent streak without blaming the gap", () => {
    const rows = [row("2026-09-13"), row("2026-09-14")];
    const summary = summarizePostTrend(rows, { days: 7, today: "2026-09-16" });
    expect(summary).toContain("直近2日は投稿が見えていない");
    expect(summary).toContain("書いていないとは限らない");
  });

  it("handles a window with no posts at all", () => {
    const summary = summarizePostTrend([row("2026-08-01")], { days: 7, today: "2026-09-16" });
    expect(summary).toContain("この期間に数えられた投稿は無かった");
    expect(summary).toContain("直近7日は投稿が見えていない");
    for (const term of FORBIDDEN_TERMS) {
      expect(summary).not.toContain(term);
    }
  });

  it("shows the last post time in JST", () => {
    const summary = summarizePostTrend(
      [row("2026-09-16", { last_post_at: "2026-09-16T12:34:00.000Z" })],
      { days: 7, today: "2026-09-16" },
    );
    expect(summary).toContain("最後に見えた投稿: 2026-09-16 21:34");
  });
});
