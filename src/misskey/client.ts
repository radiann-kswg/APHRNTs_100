import * as Misskey from "misskey-js";
import {
  computeBackoffDelay,
  isShortLivedConnection,
  resolveKeepaliveOptions,
  type KeepaliveOptions,
  type KeepaliveOverrides,
} from "./reconnect-policy.js";

export interface MentionNote {
  id: string;
  userId: string;
  text: string;
}

/** Misskeyのネイティブ Chat API（chat/messages/*）による一対一メッセージの受信ペイロード */
export interface IncomingChatMessage {
  id: string;
  fromUserId: string;
  text: string;
  createdAt: string;
}

/**
 * MisskeyClientがストリームに求める最小の構造的インターフェース。
 * misskey-jsの Misskey.Stream はイベント名ごとに厳密に型付けされているため、
 * その型の面倒はデフォルトファクトリ（createRealStream）の内部に閉じ込め、
 * クライアント本体はこの緩いインターフェースだけに依存させる（テストでのモック差し替えも容易にする）。
 */
export interface RawChannelConnection {
  on(type: string, handler: (payload: unknown) => void): void;
}

export interface RawStream {
  on(event: "_connected_" | "_disconnected_", handler: () => void): void;
  useChannel(channel: "main"): RawChannelConnection;
  ping(): void;
  close(): void;
}

export type StreamFactory = (host: string, token: string) => RawStream;

/** クライアントが使うロガーの最小インターフェース（src/utils/logger.ts の Logger と互換）。 */
export interface ClientLogger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface MisskeyClientOptions {
  host: string;
  token: string;
  /** keepalive・再接続ポリシーの上書き（省略時は既定値。ping間隔だけ変えることが多い）。 */
  keepalive?: KeepaliveOverrides;
  /** 省略可。未指定ならconsoleへ出力する。 */
  logger?: ClientLogger;
  /** テスト用: ストリーム生成を差し替える。省略時は本物の misskey-js Stream。 */
  createStream?: StreamFactory;
  /** テスト用: 現在時刻（ms）。省略時は Date.now。 */
  now?: () => number;
  /** テスト用: 0以上1未満の乱数。省略時は Math.random（ジッタ用）。 */
  random?: () => number;
}

const consoleLogger: ClientLogger = {
  error: (message, ...args) => console.error(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  info: (message, ...args) => console.log(message, ...args),
  debug: (message, ...args) => console.log(message, ...args),
};

/** 本物の misskey-js Stream を RawStream へ適合させるデフォルトファクトリ。 */
const createRealStream: StreamFactory = (host, token) => {
  const stream = new Misskey.Stream(host, { token });
  return {
    on: (event, handler) => {
      stream.on(event, handler);
    },
    useChannel: (channel) => {
      const connection = stream.useChannel(channel);
      return {
        // misskey-jsのイベント型はここで意図的に緩める（型の面倒はこの適合層に閉じ込める）。
        on: (type, handler) => {
          connection.on(type as never, handler as never);
        },
      };
    },
    ping: () => {
      stream.ping();
    },
    close: () => {
      stream.close();
    },
  };
};

// 実際のMisskeyインスタンスへのライブ接続・メンション応答（main チャンネルの
// mention イベント）を実機確認済み（2026-07-09、GCE本番デプロイでのテスト）。
// 一対一チャット（newChatMessageイベント・chat/messages/create-to-user）は
// 静的型定義（misskey-js@2025.2.0）に基づく実装。本番投入前に実機確認が必要。
//
// 接続維持: アプリレベルの定期ping（keepalive）でアイドル切断を減らし、切断時は
// misskey-js内蔵の即再接続（reconnecting-websocket, minReconnectionDelay=1ms）を
// close()で止め、指数バックオフ＋上限＋ジッタで新しいStreamを張り直す。短時間切断が
// 続く（フラッピング）場合はログを間引きつつ警告を出す。詳細な既定値は
// src/config/constants.ts、方針は src/misskey/reconnect-policy.ts を参照。
export class MisskeyClient {
  private stream: RawStream | null = null;
  private readonly api: InstanceType<typeof Misskey.api.APIClient>;
  private myUserIdPromise: Promise<string> | null = null;

  private readonly keepalive: KeepaliveOptions;
  private readonly logger: ClientLogger;
  private readonly createStream: StreamFactory;
  private readonly now: () => number;
  private readonly random: () => number;

  // 再接続監視の状態
  private started = false;
  private stopped = false;
  private onMention: ((note: MentionNote) => void) | null = null;
  private onChatMessage: ((message: IncomingChatMessage) => void) | undefined;
  private onConnectionChange: ((connected: boolean) => void) | undefined;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** 直前の安定接続以降の連続再接続試行回数（バックオフ指数）。 */
  private attempt = 0;
  /** 連続する短時間切断（フラッピング）の回数。安定接続で0に戻す。 */
  private flapCount = 0;
  private lastConnectedAtMs: number | null = null;

  constructor(private readonly options: MisskeyClientOptions) {
    this.api = new Misskey.api.APIClient({
      origin: options.host,
      credential: options.token,
    });
    this.keepalive = resolveKeepaliveOptions(options.keepalive);
    this.logger = options.logger ?? consoleLogger;
    this.createStream = options.createStream ?? createRealStream;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  connect(
    onMention: (note: MentionNote) => void,
    onChatMessage?: (message: IncomingChatMessage) => void,
    onConnectionChange?: (connected: boolean) => void,
  ): void {
    if (this.started) {
      this.logger.warn("[misskey] connect() が二重に呼ばれた。無視する");
      return;
    }
    this.started = true;
    this.stopped = false;
    this.onMention = onMention;
    this.onChatMessage = onChatMessage;
    this.onConnectionChange = onConnectionChange;
    this.openStream();
  }

  /** 新しいストリームを生成し、接続/切断ハンドラとチャンネル購読を張る。再接続時にも毎回呼ぶ。 */
  private openStream(): void {
    const stream = this.createStream(this.options.host, this.options.token);
    this.stream = stream;

    stream.on("_connected_", () => {
      this.handleConnected();
    });
    stream.on("_disconnected_", () => {
      this.handleDisconnected();
    });

    this.subscribeChannels(stream);
  }

  /** main チャンネルを購読し、mention / newChatMessage を配線する。 */
  private subscribeChannels(stream: RawStream): void {
    const mainChannel = stream.useChannel("main");

    mainChannel.on("mention", (payload) => {
      const note = payload as { id: string; userId: string; text?: string | null };
      this.onMention?.({
        id: note.id,
        userId: note.userId,
        text: note.text ?? "",
      });
    });

    if (this.onChatMessage) {
      mainChannel.on("newChatMessage", (payload) => {
        const typed = payload as {
          id: string;
          fromUserId: string;
          toUserId?: string | null;
          toRoomId?: string | null;
          text?: string | null;
          createdAt: string;
        };
        // v1はルームチャット（toRoomId）は対象外、一対一（toUserId）のみ扱う
        if (!typed.toUserId) {
          return;
        }
        void this.myUserId().then((myId) => {
          // Botが自ら送信したメッセージがストリームでエコーされる場合に備えたガード
          if (typed.fromUserId === myId) {
            return;
          }
          this.onChatMessage?.({
            id: typed.id,
            fromUserId: typed.fromUserId,
            text: typed.text ?? "",
            createdAt: typed.createdAt,
          });
        });
      });
    }
  }

  private handleConnected(): void {
    if (this.stopped) {
      return;
    }
    this.onConnectionChange?.(true);
    this.lastConnectedAtMs = this.now();
    this.startPinger();

    // 一定時間つながり続けたら「安定」とみなし、バックオフ試行回数をリセットする。
    // （切断が続く間はこのタイマーが発火せず、attemptが伸び続けてバックオフが効く）
    this.clearStabilityTimer();
    this.stabilityTimer = setTimeout(() => {
      this.attempt = 0;
      if (this.flapCount > 0) {
        this.logger.info(
          `[misskey] ${this.flapCount}回のフラッピング後に接続が安定した`,
        );
        this.flapCount = 0;
      }
    }, this.keepalive.stabilityMs);

    if (this.flapCount === 0) {
      this.logger.info("[misskey] ストリームに接続した");
    } else {
      // フラッピング中の再接続はスパムになるためdebugへ落とす
      this.logger.debug("[misskey] ストリームに再接続した（安定判定待ち）");
    }
  }

  private handleDisconnected(): void {
    // 切断中はpingしても意味がないので止める。安定判定タイマーも無効化。
    this.stopPinger();
    this.clearStabilityTimer();
    this.onConnectionChange?.(false);

    if (this.stopped) {
      return;
    }

    const shortLived = isShortLivedConnection(
      this.lastConnectedAtMs,
      this.now(),
      this.keepalive.stabilityMs,
    );
    const delay = computeBackoffDelay(this.attempt, this.keepalive.backoff, this.random());

    if (shortLived) {
      this.flapCount += 1;
      const threshold = this.keepalive.flapAlertThreshold;
      if (this.flapCount === 1) {
        this.logger.warn(`[misskey] ストリームが切断された。${delay}ms後に再接続する`);
      } else if (this.flapCount === threshold || this.flapCount % threshold === 0) {
        this.logger.warn(
          `[misskey] ストリームのフラッピングを検知（${this.flapCount}回連続の短時間切断）。バックオフ${delay}msで再接続を継続する`,
        );
      } else {
        this.logger.debug(
          `[misskey] ストリームが切断された（${this.flapCount}回目）。${delay}ms後に再接続する`,
        );
      }
    } else {
      // 安定接続からの単発切断
      this.logger.warn(`[misskey] ストリームが切断された。${delay}ms後に再接続する`);
    }

    // 次の張り直しに向けてバックオフ指数を進める。
    this.attempt += 1;

    // ネイティブ（reconnecting-websocket）の即再接続を止めてから、自前のバックオフで張り直す。
    this.closeStream();
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) {
        return;
      }
      this.openStream();
    }, delay);
  }

  private startPinger(): void {
    this.stopPinger();
    this.pingTimer = setInterval(() => {
      try {
        this.stream?.ping();
      } catch (error) {
        // ping失敗自体は致命ではない（次の切断イベントで再接続に入る）。
        this.logger.debug("[misskey] keepalive pingに失敗した", error);
      }
    }, this.keepalive.pingIntervalMs);
  }

  private stopPinger(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeStream(): void {
    if (this.stream) {
      try {
        this.stream.close();
      } catch (error) {
        this.logger.debug("[misskey] ストリームのcloseに失敗した", error);
      }
      this.stream = null;
    }
  }

  async reply(replyToNoteId: string, text: string): Promise<void> {
    await this.api.request("notes/create", {
      text,
      replyId: replyToNoteId,
    });
  }

  /** visibleUserIdsを指定した「特定ユーザー宛て」ノートを投稿する（レガシー・フォールバック用途） */
  async postNote(text: string, visibleUserIds?: string[]): Promise<void> {
    await this.api.request("notes/create", {
      text,
      visibility: visibleUserIds && visibleUserIds.length > 0 ? "specified" : "public",
      visibleUserIds,
    });
  }

  /** Misskeyのネイティブ Chat API 経由で、指定ユーザーへ一対一メッセージを送信する */
  async sendChatMessage(toUserId: string, text: string): Promise<void> {
    await this.api.request("chat/messages/create-to-user", { toUserId, text });
  }

  /**
   * 自分宛てメンションをREST APIで取得する（WS切断中の取りこぼし回収=replay用）。
   * sinceIdを渡すとそれより新しいものだけを取得する。返り値の順序はAPI依存のため呼び出し側でソートすること。
   */
  async fetchMentionsSince(sinceId: string | null, limit = 30): Promise<MentionNote[]> {
    const notes = (await this.api.request("notes/mentions", {
      limit,
      ...(sinceId ? { sinceId } : {}),
    })) as Array<{ id: string; userId: string; text?: string | null }>;
    return notes.map((note) => ({ id: note.id, userId: note.userId, text: note.text ?? "" }));
  }

  /**
   * 指定ユーザーとの一対一チャットをREST APIで取得し、相手からの受信分だけを返す（replay用）。
   * sinceIdを渡すとそれより新しいものだけを取得する。返り値の順序はAPI依存のため呼び出し側でソートすること。
   */
  async fetchOwnerChatSince(
    ownerUserId: string,
    sinceId: string | null,
    limit = 30,
  ): Promise<IncomingChatMessage[]> {
    const myId = await this.myUserId();
    const messages = (await this.api.request("chat/messages/user-timeline", {
      userId: ownerUserId,
      limit,
      ...(sinceId ? { sinceId } : {}),
    })) as Array<{ id: string; fromUserId: string; text?: string | null; createdAt: string }>;
    return messages
      .filter((message) => message.fromUserId !== myId)
      .map((message) => ({
        id: message.id,
        fromUserId: message.fromUserId,
        text: message.text ?? "",
        createdAt: message.createdAt,
      }));
  }

  private myUserId(): Promise<string> {
    this.myUserIdPromise ??= this.api.request("i", {}).then((me) => me.id);
    return this.myUserIdPromise;
  }

  disconnect(): void {
    this.stopped = true;
    this.started = false;
    this.stopPinger();
    this.clearStabilityTimer();
    this.clearReconnectTimer();
    this.closeStream();
  }
}
