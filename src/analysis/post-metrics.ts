import { toJstDateString, toJstHour } from "../utils/date.js";

/**
 * センパイ本人のMisskey投稿（users/notes）から日次の行動指標を数える純関数群（段階A）。
 *
 * 本文の意味は一切見ない（数えるだけ）。正規化したテキストも文字数を数えるためだけに使い、
 * 呼び出し側は集計が終わった時点で破棄する（本文をDB・ログに残さない＝docs/misskey-post-mood-trend.md P3）。
 */

/** users/notes から取得したノートのうち、集計に必要な最小の形。 */
export interface UserNote {
  id: string;
  userId: string;
  text: string | null;
  cw?: string | null;
  createdAt: string;
  replyId?: string | null;
  renoteId?: string | null;
  channelId?: string | null;
  visibility?: string | null;
  fileIds?: string[];
  deletedAt?: string | null;
}

export interface DailyPostMetrics {
  /** JSTのYYYY-MM-DD */
  date: string;
  postCount: number;
  replyCount: number;
  /** JST 00:00〜04:59 の投稿数 */
  nightPostCount: number;
  firstPostAt: string | null;
  lastPostAt: string | null;
  /** 正規化後テキストの合計文字数 */
  totalChars: number;
  cwCount: number;
  attachmentPostCount: number;
  /** その日のJST時間帯あたり最大投稿数（連投の目安） */
  maxBurstPerHour: number;
}

export interface MetricsOptions {
  /** この本人IDのノート以外は必ず捨てる（P1: 第三者の投稿を1件も集計に入れない） */
  ownerUserId: string;
  /** 集計対象にする可視性。省略時は public / home のみ */
  visibilities?: readonly string[];
}

export const DEFAULT_POST_VISIBILITIES = ["public", "home"] as const;

/** 深夜帯の終わり（この時刻未満を深夜とみなす）。JST 00:00〜04:59。 */
const NIGHT_END_HOUR = 5;

// URLはメンション記号・ハッシュタグ記号を含みうるため、必ず最初に落とす。
const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /@[\w.-]+(?:@[\w.-]+)?/g;
const CUSTOM_EMOJI_RE = /:[\w+-]+:/g;
const HASHTAG_RE = /#[^\s#]+/g;

/**
 * 第三者情報（メンション・URL）とMisskey固有の記法（カスタム絵文字・ハッシュタグ）を落とし、
 * 文字数を数えるためだけのテキストにする。ホスト名も残さない。
 */
export function normalizeNoteText(text: string | null | undefined): string {
  if (!text) {
    return "";
  }
  return text
    .replace(URL_RE, "")
    .replace(MENTION_RE, "")
    .replace(CUSTOM_EMOJI_RE, "")
    .replace(HASHTAG_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 集計対象に含めてよいノートか（除外の理由は docs/misskey-post-mood-trend.md「取得対象と除外」）。 */
export function isCountableNote(note: UserNote, options: MetricsOptions): boolean {
  // P1: 取得口を users/notes に固定していても、返ってきたものを無条件に信じない
  if (note.userId !== options.ownerUserId) {
    return false;
  }
  if (note.deletedAt) {
    return false;
  }
  // チャンネル投稿は場の文脈に強く依存するためノイズになりやすい
  if (note.channelId) {
    return false;
  }
  const visibilities = options.visibilities ?? DEFAULT_POST_VISIBILITIES;
  if (!visibilities.includes(note.visibility ?? "public")) {
    return false;
  }
  // 本文の無いリノートは他者の言葉。引用リノートは本人のコメント部分だけを数える
  if (note.renoteId && !(note.text ?? "").trim()) {
    return false;
  }
  return true;
}

function emptyMetrics(date: string): DailyPostMetrics {
  return {
    date,
    postCount: 0,
    replyCount: 0,
    nightPostCount: 0,
    firstPostAt: null,
    lastPostAt: null,
    totalChars: 0,
    cwCount: 0,
    attachmentPostCount: 0,
    maxBurstPerHour: 0,
  };
}

/**
 * ノート配列を日次指標（JST日付ごと）へ畳み込む。対象外のノートはここで捨てる。
 * 日付・時刻の切り方はすべてJST基準（UTCで切るとJST 0〜9時の実行で1日ズレる）。
 */
export function aggregateDailyMetrics(notes: UserNote[], options: MetricsOptions): DailyPostMetrics[] {
  const byDate = new Map<string, DailyPostMetrics>();
  const hourCounts = new Map<string, number>();

  for (const note of notes) {
    if (!isCountableNote(note, options)) {
      continue;
    }
    const createdAt = new Date(note.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      continue;
    }
    const date = toJstDateString(createdAt);
    const iso = createdAt.toISOString();
    const metrics = byDate.get(date) ?? emptyMetrics(date);

    metrics.postCount += 1;
    if (note.replyId) {
      metrics.replyCount += 1;
    }
    if (toJstHour(createdAt) < NIGHT_END_HOUR) {
      metrics.nightPostCount += 1;
    }
    if (note.cw) {
      metrics.cwCount += 1;
    }
    if (note.fileIds && note.fileIds.length > 0) {
      metrics.attachmentPostCount += 1;
    }
    metrics.totalChars += normalizeNoteText(note.text).length;
    metrics.firstPostAt = metrics.firstPostAt === null || iso < metrics.firstPostAt ? iso : metrics.firstPostAt;
    metrics.lastPostAt = metrics.lastPostAt === null || iso > metrics.lastPostAt ? iso : metrics.lastPostAt;

    byDate.set(date, metrics);

    const hourKey = `${date} ${toJstHour(createdAt)}`;
    hourCounts.set(hourKey, (hourCounts.get(hourKey) ?? 0) + 1);
  }

  for (const [hourKey, count] of hourCounts) {
    const date = hourKey.split(" ")[0] ?? "";
    const metrics = byDate.get(date);
    if (metrics && count > metrics.maxBurstPerHour) {
      metrics.maxBurstPerHour = count;
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
