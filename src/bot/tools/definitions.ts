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
    "日次チェックイン（気分・睡眠・エネルギー・創作進捗等）をSQLiteに保存する。センパイの希望により、これは他の記録系ツールと異なり事前の保存同意確認が不要な例外項目。雑談の中で体調・気分に触れた内容であっても、そのまま呼び出して保存してよい。ただし呼び出した後は必ず「記録として残しておいたぞ」等、保存した事実をセンパイに伝えること（黙って保存しない）。moodは『一日の総括値』として扱うこと。『今つらい』『朝は7だった』のような特定時点の気分は save_mood_event で記録し、総括のmoodと混同しない（瞬間的な落ち込みを一日の気分として上書きしない）。",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: DATE_FIELD_DESCRIPTION },
      mood: { type: "integer", minimum: 1, maximum: 10, description: "一日の総括の気分。特定時点の気分はsave_mood_eventを使う" },
      sleepHours: { type: "number" },
      sleepQuality: { type: "integer", minimum: 1, maximum: 5 },
      energy: { type: "integer", minimum: 1, maximum: 10 },
      notes: { type: "string" },
      creativeProgress: { type: "string" },
    },
    required: ["date"],
  },
};

export const SAVE_MOOD_EVENT_TOOL: ToolDefinition = {
  name: "save_mood_event",
  description:
    "特定時点の気分（瞬間値）を時点ラベル付きでSQLiteに保存する。『今つらい、気分3くらい』『朝は7だった』のように、一日の総括ではなくその時点の気分が語られたときに使う。日次チェックインと同様、事前の保存同意確認が不要な例外項目だが、保存したら必ずその事実をセンパイに伝えること。一日の中で複数回呼んでよく、これにより気分の推移（浮き沈み）が記録される。一日の総括の気分はsave_checkinのmoodで別途保存する。",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: DATE_FIELD_DESCRIPTION },
      timepoint: {
        type: "string",
        description: "時点ラベル。「朝」「昼」「夕方」「夜」または「HH:MM」。会話の文脈から判断して付けること",
      },
      mood: { type: "integer", minimum: 1, maximum: 10, description: "その時点の気分" },
      note: { type: "string", description: "状況の補足（任意）" },
    },
    required: ["date", "mood"],
  },
};

export const SAVE_MEDICATION_TOOL: ToolDefinition = {
  name: "save_medication",
  description:
    "服薬状況（朝・日中・食後・夜の服用有無、顬服〈発作時〉の回数・状況）をSQLiteに保存する。日次チェックインと同様、センパイの希望により事前の保存同意確認が不要な例外項目。雑談の中で服薬に触れた内容であっても、そのまま呼び出して保存してよい。ただし呼び出した後は必ず保存した事実をセンパイに伝えること（黙って保存しない）。薬の増減・変更の助言や指示は絶対に含めないこと（服用の有無を記録することに徹する）。",
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

export const SET_CRISIS_HOTLINE_PREFERENCE_TOOL: ToolDefinition = {
  name: "set_crisis_hotline_preference",
  description:
    "危機検知時（希死念慮・自傷を示唆する発言）に相談窓口（ホットライン）の案内を最優先するかどうかの、このユーザー本人の設定を切り替える。既定は有効（案内優先）。無効にすると、Botは番号の列挙より傾聴・相談を優先するようになる。ユーザー本人が「ホットラインの案内はいらない／オフにして」「窓口案内をオンにして」のように明示的に意思表示した場合にのみ呼び出すこと。会話の雰囲気や推測で勝手に呼び出してはならない。切り替えたら、その事実と、いつでも戻せることを必ず本人に伝えること。",
  inputSchema: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        description: "true=相談窓口案内を最優先（既定） / false=傾聴・相談を優先し、窓口案内を機械的に行わない",
      },
    },
    required: ["enabled"],
  },
};

export const GET_POST_TREND_TOOL: ToolDefinition = {
  name: "get_post_trend",
  description:
    "センパイ本人のMisskey投稿を数えた、直近N日（既定7日・最大30日）の「投稿の様子」（投稿数・深夜帯の投稿数・投稿のあった日数・1投稿あたりの文字数など）を返す読み取り専用ツール。返るのは数値と平常時との差だけで、評価も判定も含まない。センパイから「最近の投稿の様子は？」「投稿の傾向を見せてくれ」等と**聞かれたときだけ**呼び出すこと。聞かれていないのにこのツールを呼んで投稿の話題を切り出してはならない（見張られている感覚にしないため）。結果を伝えるときも、Bot側で調子の良し悪しを決めつけず、センパイ自身の実感と突き合わせる材料として渡すこと。この機能は既定オフで、本人がオンにしていなければその旨が返る。",
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "integer", minimum: 1, maximum: 30, description: "遡る日数（今日を含む）。省略時は7。" },
    },
  },
};

export const SET_POST_ANALYSIS_PREFERENCE_TOOL: ToolDefinition = {
  name: "set_post_analysis_preference",
  description:
    "Misskeyの本人投稿からの傾向集計（get_post_trendで見られる数値）のオン/オフを切り替える。既定はオフ。オンにすると1日1回、センパイ本人の投稿だけを数えて日次の指標を保存する（投稿本文は保存しない。他ユーザーの投稿は取得しない）。オフにすると、それまでに溜めた集計と取得位置をその場で全部削除する（元に戻せない）。ユーザー本人が「投稿の傾向を見られるようにして」「投稿の集計はオフにして」のように明示的に意思表示した場合にのみ呼び出すこと。推測で勝手に呼び出してはならない。切り替えたら、その事実と、いつでも戻せる／オフにすればデータが消えることを必ず本人に伝えること。",
  inputSchema: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        description: "true=投稿からの集計を有効にする / false=無効にし、蓄積済みの集計を削除する（既定）",
      },
    },
    required: ["enabled"],
  },
};

export const ALL_TOOLS: ToolDefinition[] = [
  GET_RECENT_RECORDS_TOOL,
  SAVE_CHECKIN_TOOL,
  SAVE_MOOD_EVENT_TOOL,
  SAVE_MEDICATION_TOOL,
  SAVE_THOUGHT_RECORD_TOOL,
  SAVE_GRATITUDE_TOOL,
  SAVE_ACTIVITY_TOOL,
  SET_CRISIS_HOTLINE_PREFERENCE_TOOL,
  GET_POST_TREND_TOOL,
  SET_POST_ANALYSIS_PREFERENCE_TOOL,
];
