import type { ToolDefinition } from "../../ai/provider.js";

// .cbt-datas/distortions.md の10項目に対応するID一覧
export const DISTORTION_IDS = [
  "all_or_nothing",
  "overgeneralization",
  "mental_filter",
  "disqualifying_positive",
  "jumping_to_conclusions",
  "magnification_minimization",
  "emotional_reasoning",
  "should_statements",
  "labeling",
  "personalization",
] as const;

export const SAVE_CHECKIN_TOOL: ToolDefinition = {
  name: "save_checkin",
  description:
    "日次チェックイン（気分・睡眠・エネルギー・創作進捗等）をSQLiteに保存する。センパイの希望により、これは他の記録系ツールと異なり事前の保存同意確認が不要な例外項目。雑談の中で体調・気分に触れた内容であっても、そのまま呼び出して保存してよい。ただし呼び出した後は必ず「記録として残しておいたぞ」等、保存した事実をセンパイに伝えること（黙って保存しない）。",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD形式の日付" },
      mood: { type: "integer", minimum: 1, maximum: 10 },
      sleepHours: { type: "number" },
      sleepQuality: { type: "integer", minimum: 1, maximum: 5 },
      energy: { type: "integer", minimum: 1, maximum: 10 },
      notes: { type: "string" },
      creativeProgress: { type: "string" },
    },
    required: ["date"],
  },
};

export const SAVE_THOUGHT_RECORD_TOOL: ToolDefinition = {
  name: "save_thought_record",
  description:
    "センパイが保存に同意した思考記録（状況・自動思考・感情・認知の歪み・根拠・反証・バランス思考・再評価）をSQLiteに保存する。",
  inputSchema: {
    type: "object",
    properties: {
      situation: { type: "string" },
      automaticThought: { type: "string" },
      emotionLabel: { type: "string" },
      emotionIntensity: { type: "integer", minimum: 0, maximum: 100 },
      distortionId: { type: "string", enum: [...DISTORTION_IDS] },
      evidenceFor: { type: "string" },
      evidenceAgainst: { type: "string" },
      balancedThought: { type: "string" },
      reRatedEmotionIntensity: { type: "integer", minimum: 0, maximum: 100 },
    },
    required: ["situation", "automaticThought"],
  },
};

export const SAVE_GRATITUDE_TOOL: ToolDefinition = {
  name: "save_gratitude",
  description: "センパイが挙げた「良かったこと」3つをSQLiteに保存する。",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD形式の日付" },
      item1: { type: "string" },
      item2: { type: "string" },
      item3: { type: "string" },
    },
    required: ["date", "item1", "item2", "item3"],
  },
};

export const SAVE_ACTIVITY_TOOL: ToolDefinition = {
  name: "save_activity",
  description: "行動活性化の活動計画・実施記録（予測/実際の快感・達成感）をSQLiteに保存する。",
  inputSchema: {
    type: "object",
    properties: {
      activity: { type: "string" },
      predictedPleasure: { type: "integer", minimum: 0, maximum: 10 },
      predictedMastery: { type: "integer", minimum: 0, maximum: 10 },
      actualPleasure: { type: "integer", minimum: 0, maximum: 10 },
      actualMastery: { type: "integer", minimum: 0, maximum: 10 },
      status: { type: "string", enum: ["planned", "completed", "skipped"] },
    },
    required: ["activity"],
  },
};

export const ALL_TOOLS: ToolDefinition[] = [
  SAVE_CHECKIN_TOOL,
  SAVE_THOUGHT_RECORD_TOOL,
  SAVE_GRATITUDE_TOOL,
  SAVE_ACTIVITY_TOOL,
];
