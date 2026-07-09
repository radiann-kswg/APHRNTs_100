import * as Misskey from "misskey-js";

export interface MentionNote {
  id: string;
  userId: string;
  text: string;
}

export interface MisskeyClientOptions {
  host: string;
  token: string;
}

// 実際のMisskeyインスタンスへのライブ接続・メンション応答（main チャンネルの
// mention イベント）を実機確認済み（2026-07-09、GCE本番デプロイでのテスト）。
export class MisskeyClient {
  private stream: InstanceType<typeof Misskey.Stream> | null = null;
  private readonly api: InstanceType<typeof Misskey.api.APIClient>;

  constructor(private readonly options: MisskeyClientOptions) {
    this.api = new Misskey.api.APIClient({
      origin: options.host,
      credential: options.token,
    });
  }

  connect(onMention: (note: MentionNote) => void): void {
    this.stream = new Misskey.Stream(this.options.host, { token: this.options.token });

    this.stream.on("_connected_", () => {
      console.log("[misskey] ストリームに接続した");
    });
    this.stream.on("_disconnected_", () => {
      console.warn("[misskey] ストリームが切断された。自動再接続を待つ");
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
  }

  async reply(replyToNoteId: string, text: string): Promise<void> {
    await this.api.request("notes/create", {
      text,
      replyId: replyToNoteId,
    });
  }

  /** visibleUserIdsを指定した「特定ユーザー宛て」ノートを投稿する（週次振り返り等の能動的な通知用） */
  async postNote(text: string, visibleUserIds?: string[]): Promise<void> {
    await this.api.request("notes/create", {
      text,
      visibility: visibleUserIds && visibleUserIds.length > 0 ? "specified" : "public",
      visibleUserIds,
    });
  }

  disconnect(): void {
    this.stream?.close();
    this.stream = null;
  }
}
