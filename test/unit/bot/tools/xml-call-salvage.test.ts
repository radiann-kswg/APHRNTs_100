import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "../../../../src/bot/tools/definitions.js";
import { containsLeakedToolCallMarkup, salvageLeakedToolCalls } from "../../../../src/bot/tools/xml-call-salvage.js";

// 2026-08-30に一対一チャットで実際に投稿された漏出XML（スマート引用符・末尾切断つき）の再現
const LEAKED_REAL_CASE = `<function_calls>
<invoke name=”save_mood_event”>
<parameter name=”date”>2026-08-30</parameter>
<parameter name=”mood”>4</parameter>
<parameter name=”timepoint”>14:00</parameter>
<parameter name=”note”>13時まで作業していたが14時頃から急に無気力に。エネルギーも同程度まで低下</parameter>
</invoke>
<invoke name=”save_medication”>
<parameter name=”date”>2026-08-30</parameter>
<parameter name=”middayTaken”>true</parameter>
<parameter name=”prnCount”>1</parameter>
<parameter name=”prnNotes”>13:15 日中薬と一緒に低気圧頭痛の漢方を服用／16:00 頓服の抗鬱剤を服用</parameter>
<parameter name=”notes”>14時頃からの無気力・気分低下（気分/エネルギーとも4程度）への対応</parameter>
</invoke>`;

describe("containsLeakedToolCallMarkup", () => {
  it("漏出XMLを検出する", () => {
    expect(containsLeakedToolCallMarkup(LEAKED_REAL_CASE)).toBe(true);
    expect(containsLeakedToolCallMarkup('<invoke name="save_checkin">')).toBe(true);
  });

  it("通常の本文には反応しない", () => {
    expect(containsLeakedToolCallMarkup("記録しておいたぞ、センパイ。無理するなよ。")).toBe(false);
  });
});

describe("salvageLeakedToolCalls", () => {
  it("実例（スマート引用符・閉じfunction_calls欠落）から2件の呼び出しを型変換つきで回収する", () => {
    const result = salvageLeakedToolCalls(LEAKED_REAL_CASE, ALL_TOOLS);

    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toEqual({
      name: "save_mood_event",
      input: {
        date: "2026-08-30",
        mood: 4,
        timepoint: "14:00",
        note: "13時まで作業していたが14時頃から急に無気力に。エネルギーも同程度まで低下",
      },
    });
    expect(result.calls[1]?.name).toBe("save_medication");
    expect(result.calls[1]?.input.middayTaken).toBe(true);
    expect(result.calls[1]?.input.prnCount).toBe(1);
    // 本文からXMLは完全に除去される
    expect(result.text).toBe("");
  });

  it("XML前後の通常テキストは保持する", () => {
    const text = `記録するぞ。\n<function_calls>\n<invoke name="save_checkin">\n<parameter name="date">2026-08-30</parameter>\n<parameter name="mood">4</parameter>\n</invoke>\n</function_calls>\n保存しておいた。`;
    const result = salvageLeakedToolCalls(text, ALL_TOOLS);

    expect(result.calls).toEqual([{ name: "save_checkin", input: { date: "2026-08-30", mood: 4 } }]);
    expect(result.text).toMatch(/^記録するぞ。\s*保存しておいた。$/);
  });

  it("トークン上限で途中切断されたinvokeは実行に回さず、残骸ごと本文から除去する", () => {
    const text = `<invoke name="save_mood_event">\n<parameter name="date">2026-08-30</parameter>\n<parameter name="mood">4</parameter>\n</invoke>\n<invoke name="save_medication">\n<parameter name="date">2026-08-3`;
    const result = salvageLeakedToolCalls(text, ALL_TOOLS);

    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.name).toBe("save_mood_event");
    expect(result.text).toBe("");
  });

  it("未知のツール名は実行に回さないが、本文からは除去する", () => {
    const text = `<invoke name="delete_everything">\n<parameter name="target">all</parameter>\n</invoke>`;
    const result = salvageLeakedToolCalls(text, ALL_TOOLS);

    expect(result.calls).toEqual([]);
    expect(result.text).toBe("");
  });

  it("boolean/numberに変換できない値はパラメータごと落とす", () => {
    const text = `<invoke name="save_medication">\n<parameter name="date">2026-08-30</parameter>\n<parameter name="middayTaken">たぶん</parameter>\n<parameter name="prnCount">数回</parameter>\n</invoke>`;
    const result = salvageLeakedToolCalls(text, ALL_TOOLS);

    expect(result.calls).toEqual([{ name: "save_medication", input: { date: "2026-08-30" } }]);
  });
});
