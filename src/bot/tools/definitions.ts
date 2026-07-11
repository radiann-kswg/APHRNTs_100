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

export const GET_RECENT_RECORDS_TOOL: ToolDefinition = {
  name: "get_recent_records",
  description:
    "直近N日分（デフォルト3日、最大14日）のチェックイン・服薬記録について、6項目（気分・睡眠・エネルギー・創作進捗・服薬・メモ）それぞれが記録済みか未記録かを日付ごとに返す読み取り専用ツール。センパイに「もう記録した？」等と聞かれたとき、前日以前の記録を遡って確認・追記するときは、記憶や会話の流れだけで判断せず必ず先にこれを呼び出すこと。",
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "integer", minimum: 1, maximum: 14, description: "遡る日数（今日を含む）。省略時は3。" },
    },
  },
};

const DATE_FIELD_DESCRIPTION =
  "YYYY-MM-DD形式の日付。省略時は今日(JST)扱いになるが、システムプロンプト冒頭の『現在日時（JST基準）』を基準に「今日」「昨日」等を計算し、明示的に指定すること。";

export const SAVE_CHECKIN_TOOL: ToolDefinition = {
  name: "save_checkin",
  description:
    "日次チェックイン（気分・睡眠・エネルギー・創作進捗等）をSQLiteに保存する。センパイの希望により、これは他の記録系ツールと異なり事前の保存同意確認が不要な例外項目。雑談の中で体調・気分に触れた内容であっても、そのまま呼び出して保存してよい。ただし呼び出した後は必ず「記録として残しておいたぞ」等、保存した事実をセンパイに伝えること（黙って保存しない）。",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: DATE_FIELD_DESCRIPTION },
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

export const SAVE_MEDICATION_TOOL: ToolDefinition = {
  name: "save_medication",
  description:
    "服薬状況（朝・日中・食後・夜の服用有無、頓服〈発作時〉の回数・状況）をSQLiteに保存する。日次チェックインと同様、センパイの希望により事前の保存同意確認が不要な例外項目。雑談の中で服薬に触れた内容であっても、そのまま呼び出して保存してよい。ただし呼び出した後は必ず保存した事実をセンパイに伝えること（黙って保存しない）。薬の増減・変更の助言や指示は絶対に含めないこと（服用の有無を記録することに徹する）。",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: DATE_FIELD_DESCRIPTION },
      morningTaken: { type: "boolean" },
      middayTaken: { type: "boolean" },
      afterMealTaken: { type: "boolean" },
      nightTaken: { type: "boolean" },
      prnCount: { type: "integer", minimum: 0 },
      prnNotes: { type: "string" },
      notes: { type: "string" },
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
      date: { type: "string", description: DATE_FIELD_DESCRIPTION },
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
  GET_RECENT_RECORDS_TOOL,
  SAVE_CHECKIN_TOOL,
  SAVE_MEDICATION_TOOL,
  SAVE_THOUGHT_RECORD_TOOL,
  SAVE_GRATITUDE_TOOL,
  SAVE_ACTIVITY_TOOL,
];
