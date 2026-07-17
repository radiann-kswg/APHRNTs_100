import * as Misskey from "misskey-js";

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

export interface MisskeyClientOptions {
  host: string;
  token: string;
}

// 実際のMisskeyインスタンスへのライブ接続・メンション応答（main チャンネルの
// mention イベント）を実機確認済み（2026-07-09、GCE本番デプロイでのテスト）。
// 一対一チャット（newChatMessageイベント・chat/messages/create-to-user）は
// 静的型定義（misskey-js@2025.2.0）に基づく実装。本番投入前に実機確認が必要。
export class MisskeyClient {
  private stream: InstanceType<typeof Misskey.Stream> | null = null;
  private readonly api: InstanceType<typeof Misskey.api.APIClient>;
  private myUserIdPromise: Promise<string> | null = null;

  constructor(private readonly options: MisskeyClientOptions) {
    this.api = new Misskey.api.APIClient({
      origin: options.host,
      credential: options.token,
    });
  }

  connect(
    onMention: (note: MentionNote) => void,
    onChatMessage?: (message: IncomingChatMessage) => void,
    onConnectionChange?: (connected: boolean) => void,
  ): void {
    this.stream = new Misskey.Stream(this.options.host, { token: this.options.token });

    this.stream.on("_connected_", () => {
      console.log("[misskey] ストリームに接続した");
      onConnectionChange?.(true);
    });
    this.stream.on("_disconnected_", () => {
      console.warn("[misskey] ストリームが切断された。自動再接続を待つ");
      onConnectionChange?.(false);
    });

    const mainChannel = this.stream.useChannel("main");
    mainChannel.on("mention", (note) => {
      const typedNote = note as { id: string; userId: string; text?: string | null };
      onMention({
        id: typedNote.id,
        userId: typedNote.userId,
        text: typedNote.text ?? "",
      });
    });

    if (onChatMessage) {
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
          onChatMessage({
            id: typed.id,
            fromUserId: typed.fromUserId,
            text: typed.text ?? "",
            createdAt: typed.createdAt,
          });
        });
      });
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
    this.stream?.close();
    this.stream = null;
  }
}
