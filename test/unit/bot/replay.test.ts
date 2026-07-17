import { describe, expect, it } from "vitest";
import { createReplayRunner, type ReplayStateStore } from "../../../src/bot/replay.js";
import type { IncomingChatMessage, MentionNote } from "../../../src/misskey/client.js";

class FakeStateStore implements ReplayStateStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function mention(id: string, text = `m-${id}`): MentionNote {
  return { id, userId: "sender", text };
}

function chat(id: string, text = `c-${id}`): IncomingChatMessage {
  return { id, fromUserId: "owner1", text, createdAt: "2026-07-17T00:00:00.000Z" };
}

interface Handled {
  mentions: MentionNote[];
  chats: IncomingChatMessage[];
}

function setup(options?: {
  mentionsOnServer?: MentionNote[];
  chatsOnServer?: IncomingChatMessage[];
  ownerUserId?: string;
  failMentionIds?: Set<string>;
}) {
  const handled: Handled = { mentions: [], chats: [] };
  const stateStore = new FakeStateStore();
  const fetchCalls: Array<{ kind: "mention" | "chat"; sinceId: string | null }> = [];
  const runner = createReplayRunner({
    source: {
      fetchMentionsSince: (sinceId) => {
        fetchCalls.push({ kind: "mention", sinceId });
        const all = options?.mentionsOnServer ?? [];
        return Promise.resolve(sinceId === null ? all : all.filter((n) => n.id > sinceId));
      },
      fetchOwnerChatSince: (_ownerUserId, sinceId) => {
        fetchCalls.push({ kind: "chat", sinceId });
        const all = options?.chatsOnServer ?? [];
        return Promise.resolve(sinceId === null ? all : all.filter((m) => m.id > sinceId));
      },
    },
    stateStore,
    ownerUserId: options?.ownerUserId ?? "owner1",
    onMention: (note) => {
      if (options?.failMentionIds?.has(note.id)) {
        return Promise.reject(new Error(`handler failed for ${note.id}`));
      }
      handled.mentions.push(note);
      return Promise.resolve();
    },
    onChatMessage: (message) => {
      handled.chats.push(message);
      return Promise.resolve();
    },
  });
  return { runner, handled, stateStore, fetchCalls };
}

describe("createReplayRunner", () => {
  it("初回（最終ID未記録）はベースラインの記録のみで、過去分へ遡って応答しない", async () => {
    const { runner, handled, stateStore } = setup({
      mentionsOnServer: [mention("a1"), mention("a2"), mention("a3")],
      chatsOnServer: [chat("b1"), chat("b2")],
    });

    const result = await runner.runReplay();

    expect(result).toEqual({ mentions: 0, chats: 0 });
    expect(handled.mentions).toHaveLength(0);
    expect(handled.chats).toHaveLength(0);
    // 最新IDがベースラインとして記録され、次回以降はここから先だけを回収する
    expect(stateStore.get("replay_last_mention_id")).toBe("a3");
    expect(stateStore.get("replay_last_chat_id")).toBe("b2");
  });

  it("2回目以降は最終IDより新しいものだけを昇順で処理し、最終IDを進める", async () => {
    const { runner, handled, stateStore } = setup({
      // サーバー応答が新しい順でも、昇順に直して処理されること
      mentionsOnServer: [mention("a4"), mention("a3"), mention("a2")],
      chatsOnServer: [chat("b3"), chat("b2")],
    });
    stateStore.set("replay_last_mention_id", "a2");
    stateStore.set("replay_last_chat_id", "b1");

    const result = await runner.runReplay();

    expect(result).toEqual({ mentions: 2, chats: 2 });
    expect(handled.mentions.map((n) => n.id)).toEqual(["a3", "a4"]);
    expect(handled.chats.map((m) => m.id)).toEqual(["b2", "b3"]);
    expect(stateStore.get("replay_last_mention_id")).toBe("a4");
    expect(stateStore.get("replay_last_chat_id")).toBe("b3");
  });

  it("ストリーム経由で処理済みのIDはreplayで二重処理しない", async () => {
    const { runner, handled, stateStore } = setup({
      mentionsOnServer: [mention("a3"), mention("a4")],
    });
    stateStore.set("replay_last_mention_id", "a2");
    // a3はストリームで処理済み（markMentionProcessedにより最終IDもa3へ進む）
    runner.markMentionProcessed("a3");

    const result = await runner.runReplay();

    expect(result.mentions).toBe(1);
    expect(handled.mentions.map((n) => n.id)).toEqual(["a4"]);
  });

  it("markXxxProcessedは最終IDを巻き戻さない（古いIDで上書きしない）", () => {
    const { runner, stateStore } = setup();
    runner.markMentionProcessed("a5");
    runner.markMentionProcessed("a3");
    expect(stateStore.get("replay_last_mention_id")).toBe("a5");
  });

  it("ownerUserIdが空のときは一対一チャットのreplayをスキップする", async () => {
    const { runner, fetchCalls, stateStore } = setup({
      ownerUserId: "",
      mentionsOnServer: [mention("a2")],
      chatsOnServer: [chat("b2")],
    });
    stateStore.set("replay_last_mention_id", "a1");

    const result = await runner.runReplay();

    expect(result.chats).toBe(0);
    expect(fetchCalls.filter((c) => c.kind === "chat")).toHaveLength(0);
  });

  it("ハンドラが失敗したメッセージは処理済みにせず、次回のreplayで再試行できる", async () => {
    const failMentionIds = new Set(["a3"]);
    const { runner, handled, stateStore } = setup({
      mentionsOnServer: [mention("a3"), mention("a4")],
      chatsOnServer: [],
      failMentionIds,
    });
    stateStore.set("replay_last_mention_id", "a2");

    await expect(runner.runReplay()).rejects.toThrow("handler failed for a3");
    // 失敗地点で中断: a3もa4も最終IDに反映されない
    expect(stateStore.get("replay_last_mention_id")).toBe("a2");
    expect(handled.mentions).toHaveLength(0);

    // ハンドラが復旧すれば、次回のreplayで両方とも回収される
    failMentionIds.clear();
    const result = await runner.runReplay();
    expect(result.mentions).toBe(2);
    expect(handled.mentions.map((n) => n.id)).toEqual(["a3", "a4"]);
  });
});
