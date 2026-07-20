import type { IncomingChatMessage, MentionNote } from "../misskey/client.js";

// bot_state に保存するキー（処理済みの最終ID。Misskeyのidは時系列順の文字列なので辞書順比較できる）
const LAST_MENTION_ID_KEY = "replay_last_mention_id";
const LAST_CHAT_ID_KEY = "replay_last_chat_id";
// ストリーム経由で処理済みのIDを覚えておく上限（プロセス内メモリ。再起動時はbot_stateが頼り）
const RECENT_IDS_MAX = 200;

/**
 * replayが必要とする最小限の状態ストア。BotStateStoreが構造的に満たす
 * （テストではインメモリ実装を差し替えられるように、クラスではなくインターフェースに依存する）。
 */
export interface ReplayStateStore {
  get(key: string): string | null;
  set(key: string, value: string, now?: Date): void;
}

/** replayが必要とするMisskey API側の取得口。MisskeyClientが構造的に満たす。 */
export interface ReplaySource {
  fetchMentionsSince(sinceId: string | null): Promise<MentionNote[]>;
  fetchOwnerChatSince(ownerUserId: string, sinceId: string | null): Promise<IncomingChatMessage[]>;
}

export interface ReplayRunnerDeps {
  source: ReplaySource;
  stateStore: ReplayStateStore;
  /** 空文字の場合、一対一チャットのreplayはスキップする（対象ユーザーを特定できないため） */
  ownerUserId: string;
  onMention(note: MentionNote): Promise<void>;
  onChatMessage(message: IncomingChatMessage): Promise<void>;
}

export interface ReplayResult {
  mentions: number;
  chats: number;
}

export interface ReplayRunner {
  /**
   * ストリーム経由でメンションの処理を**始める前**に呼ぶ。
   * まだ誰も処理していなければ「処理中」として印を付けて true を返す。
   * 既にreplay側で処理中・処理済み（または二重配信）の場合は false を返すので、
   * 呼び出し側は処理をスキップすること（応答の二重送信を防ぐ）。
   */
  beginMention(id: string): boolean;
  /** ストリーム経由で一対一チャットの処理を始める前に呼ぶ（詳細は beginMention と同じ） */
  beginChat(id: string): boolean;
  /**
   * beginMention で付けた「処理中」の印を取り消す（ハンドラが失敗したときに呼ぶ）。
   * 印を外すことで、次回のreplayが同じメッセージを再試行できる。
   */
  abortMention(id: string): void;
  /** beginChat で付けた「処理中」の印を取り消す（詳細は abortMention と同じ） */
  abortChat(id: string): void;
  /** ストリーム経由でメンションを処理し終えたら呼ぶ（replayとの二重処理を防ぐ） */
  markMentionProcessed(id: string): void;
  /** ストリーム経由で一対一チャットを処理し終えたら呼ぶ */
  markChatProcessed(id: string): void;
  /**
   * WebSocket切断中に届いていたメンション・一対一チャットをREST APIで回収して処理する。
   * 再接続時と起動時に呼ぶ想定。実行中の多重呼び出しは何もしない。
   */
  runReplay(): Promise<ReplayResult>;
}

/** 直近に処理した（または処理中の）IDの集合（上限付き・挿入順で古いものから捨てる） */
class RecentIdSet {
  private readonly ids = new Set<string>();
  private readonly order: string[] = [];

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.order.push(id);
    if (this.order.length > RECENT_IDS_MAX) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.ids.delete(oldest);
    }
  }

  /** まだ含まれていなければ追加して true、既に含まれていれば false（check-and-addを1操作で行う） */
  tryAdd(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.add(id);
    return true;
  }

  /** 処理に失敗したIDの印を外す（次回のreplayで再試行できるようにする） */
  delete(id: string): void {
    if (!this.ids.delete(id)) return;
    const index = this.order.indexOf(id);
    if (index !== -1) this.order.splice(index, 1);
  }
}

function maxId(current: string | null, candidate: string): string {
  return current !== null && current > candidate ? current : candidate;
}

function sortByIdAscending<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * WS切断中のメッセージ取りこぼしを再接続時に回収する「replay」ランナー。
 *
 * 仕組み:
 * - ストリームで処理を**始める前**に beginXxx() で「処理中」の印を付け、処理を終えたら
 *   markXxxProcessed() で「処理済みの最終ID」をbot_stateへ永続化する（失敗時は abortXxx() で印を外す）。
 * - 再接続時に runReplay() がREST API（notes/mentions・chat/messages/user-timeline）で
 *   最終ID以降のメッセージを取得し、未処理ぶんだけを通常のハンドラへ流す。
 * - 初回起動（最終IDが未記録）のときは、過去のメンションへ遡って応答しないよう
 *   ベースライン（現時点の最新ID）だけを記録して何も処理しない。
 * - ハンドラが失敗したメッセージは処理済みにせず中断する（次回のreplayで再試行される）。
 *
 * 二重応答の防止（beginXxx が必要な理由）:
 * ストリーム処理はAI応答の生成に数秒〜数十秒かかるため、「受信したがまだ
 * markXxxProcessed されていない」時間窓が生まれる。この窓の間に定期replayが走ると、
 * 同じメッセージをREST APIから拾って二重に応答してしまう（実際に一対一チャットで
 * 同じ発言へ2回返信する不具合が起きた）。処理の**開始時点**で印を付けることでこの
 * 競合を塞ぐ。逆にreplay側も、処理開始前に印を付けるため、replay処理中に同じ
 * メッセージがストリームで届いても二重処理にならない。
 */
export function createReplayRunner(deps: ReplayRunnerDeps): ReplayRunner {
  const recentMentionIds = new RecentIdSet();
  const recentChatIds = new RecentIdSet();
  let running = false;

  function markMentionProcessed(id: string): void {
    recentMentionIds.add(id);
    deps.stateStore.set(LAST_MENTION_ID_KEY, maxId(deps.stateStore.get(LAST_MENTION_ID_KEY), id));
  }

  function markChatProcessed(id: string): void {
    recentChatIds.add(id);
    deps.stateStore.set(LAST_CHAT_ID_KEY, maxId(deps.stateStore.get(LAST_CHAT_ID_KEY), id));
  }

  async function replayMentions(): Promise<number> {
    const lastId = deps.stateStore.get(LAST_MENTION_ID_KEY);
    const fetched = sortByIdAscending(await deps.source.fetchMentionsSince(lastId));
    if (lastId === null) {
      // 初回はベースラインの記録のみ（導入前の過去メンションに遡って応答しない）
      const newest = fetched[fetched.length - 1];
      if (newest) deps.stateStore.set(LAST_MENTION_ID_KEY, newest.id);
      return 0;
    }
    let processed = 0;
    for (const note of fetched) {
      if (note.id <= lastId) continue;
      // 処理の開始時点で印を付ける（ストリーム側で処理中・処理済みならスキップ）
      if (!recentMentionIds.tryAdd(note.id)) continue;
      try {
        await deps.onMention(note);
      } catch (error) {
        // 失敗したら印を外して中断する（次回のreplayで再試行できるように）
        recentMentionIds.delete(note.id);
        throw error;
      }
      markMentionProcessed(note.id);
      processed += 1;
    }
    return processed;
  }

  async function replayChats(): Promise<number> {
    if (!deps.ownerUserId) return 0;
    const lastId = deps.stateStore.get(LAST_CHAT_ID_KEY);
    const fetched = sortByIdAscending(await deps.source.fetchOwnerChatSince(deps.ownerUserId, lastId));
    if (lastId === null) {
      const newest = fetched[fetched.length - 1];
      if (newest) deps.stateStore.set(LAST_CHAT_ID_KEY, newest.id);
      return 0;
    }
    let processed = 0;
    for (const message of fetched) {
      if (message.id <= lastId) continue;
      // 処理の開始時点で印を付ける（ストリーム側で処理中・処理済みならスキップ）
      if (!recentChatIds.tryAdd(message.id)) continue;
      try {
        await deps.onChatMessage(message);
      } catch (error) {
        // 失敗したら印を外して中断する（次回のreplayで再試行できるように）
        recentChatIds.delete(message.id);
        throw error;
      }
      markChatProcessed(message.id);
      processed += 1;
    }
    return processed;
  }

  async function runReplay(): Promise<ReplayResult> {
    if (running) return { mentions: 0, chats: 0 };
    running = true;
    try {
      const mentions = await replayMentions();
      const chats = await replayChats();
      return { mentions, chats };
    } finally {
      running = false;
    }
  }

  return {
    beginMention: (id) => recentMentionIds.tryAdd(id),
    beginChat: (id) => recentChatIds.tryAdd(id),
    abortMention: (id) => recentMentionIds.delete(id),
    abortChat: (id) => recentChatIds.delete(id),
    markMentionProcessed,
    markChatProcessed,
    runReplay,
  };
}
