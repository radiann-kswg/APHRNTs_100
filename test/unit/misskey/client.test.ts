import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MisskeyClient,
  type ClientLogger,
  type IncomingChatMessage,
  type MentionNote,
  type RawStream,
  type StreamFactory,
} from "../../../src/misskey/client.js";

interface MockStream {
  raw: RawStream;
  emitConnected(): void;
  emitDisconnected(): void;
  emitMention(payload: unknown): void;
  emitChat(payload: unknown): void;
  pingCount: number;
  closed: boolean;
  channelSubscribed: boolean;
}

/** RawStreamのモックを生成し、生成順に streams へ記録するファクトリを返す。 */
function createStreamHarness(): { factory: StreamFactory; streams: MockStream[] } {
  const streams: MockStream[] = [];
  const factory: StreamFactory = () => {
    const connectedHandlers: (() => void)[] = [];
    const disconnectedHandlers: (() => void)[] = [];
    const channelHandlers: Record<string, ((payload: unknown) => void)[]> = {};
    const mock: MockStream = {
      pingCount: 0,
      closed: false,
      channelSubscribed: false,
      raw: {
        on: (event, handler) => {
          if (event === "_connected_") {
            connectedHandlers.push(handler);
          } else {
            disconnectedHandlers.push(handler);
          }
        },
        useChannel: () => {
          mock.channelSubscribed = true;
          return {
            on: (type, handler) => {
              (channelHandlers[type] ??= []).push(handler);
            },
          };
        },
        ping: () => {
          mock.pingCount += 1;
        },
        close: () => {
          mock.closed = true;
        },
      },
      emitConnected: () => connectedHandlers.forEach((handler) => handler()),
      emitDisconnected: () => disconnectedHandlers.forEach((handler) => handler()),
      emitMention: (payload) => (channelHandlers["mention"] ?? []).forEach((handler) => handler(payload)),
      emitChat: (payload) => (channelHandlers["newChatMessage"] ?? []).forEach((handler) => handler(payload)),
    };
    streams.push(mock);
    return mock.raw;
  };
  return { factory, streams };
}

function createSpyLogger(): ClientLogger & {
  warns: string[];
  infos: string[];
  debugs: string[];
} {
  const warns: string[] = [];
  const infos: string[] = [];
  const debugs: string[] = [];
  return {
    warns,
    infos,
    debugs,
    error: () => {},
    warn: (message) => warns.push(message),
    info: (message) => infos.push(message),
    debug: (message) => debugs.push(message),
  };
}

const KEEPALIVE = {
  pingIntervalMs: 1000,
  backoff: { baseMs: 1000, factor: 2, maxMs: 30000, jitterRatio: 0.2 },
  stabilityMs: 60000,
  flapAlertThreshold: 3,
};

function latest(streams: MockStream[]): MockStream {
  const stream = streams[streams.length - 1];
  if (!stream) {
    throw new Error("no stream created yet");
  }
  return stream;
}

describe("MisskeyClient keepalive & reconnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeClient(overrides?: Partial<ConstructorParameters<typeof MisskeyClient>[0]>) {
    const harness = createStreamHarness();
    const logger = createSpyLogger();
    const client = new MisskeyClient({
      host: "https://example.test",
      token: "token",
      keepalive: KEEPALIVE,
      logger,
      createStream: harness.factory,
      now: () => Date.now(),
      random: () => 0.5, // ジッタ0固定でバックオフ待機時間を厳密化
      ...overrides,
    });
    return { client, harness, logger };
  }

  it("sends keepalive pings on an interval only while connected", () => {
    const { client, harness } = makeClient();
    client.connect(() => {});
    latest(harness.streams).emitConnected();

    vi.advanceTimersByTime(1000);
    expect(latest(harness.streams).pingCount).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(latest(harness.streams).pingCount).toBe(3);

    // 切断されたらpingを止める
    const before = latest(harness.streams);
    before.emitDisconnected();
    vi.advanceTimersByTime(5000);
    expect(before.pingCount).toBe(3);
  });

  it("closes the dead stream and reconnects after the backoff delay, re-subscribing channels", () => {
    const received: MentionNote[] = [];
    const { client, harness } = makeClient();
    client.connect((note) => received.push(note));

    const first = latest(harness.streams);
    first.emitConnected();
    expect(first.channelSubscribed).toBe(true);

    // すぐに切断（短命）→ attempt=0のバックオフ1000ms後に再接続
    vi.advanceTimersByTime(500);
    first.emitDisconnected();
    expect(first.closed).toBe(true);
    expect(harness.streams).toHaveLength(1); // まだ再接続していない

    vi.advanceTimersByTime(999);
    expect(harness.streams).toHaveLength(1);
    vi.advanceTimersByTime(1); // 1000ms到達で再接続
    expect(harness.streams).toHaveLength(2);

    const second = latest(harness.streams);
    expect(second.channelSubscribed).toBe(true);
    second.emitConnected();

    // 張り直した新しいストリーム経由でmentionが届く
    second.emitMention({ id: "n1", userId: "u1", text: "やあ" });
    expect(received).toEqual([{ id: "n1", userId: "u1", text: "やあ" }]);
  });

  it("grows the reconnect delay exponentially across consecutive flaps", () => {
    const { client, harness } = makeClient();
    client.connect(() => {});

    const expectedDelays = [1000, 2000, 4000];
    latest(harness.streams).emitConnected();

    for (let i = 0; i < expectedDelays.length; i++) {
      const delay = expectedDelays[i] as number;
      const streamCountBefore = harness.streams.length;

      vi.advanceTimersByTime(100); // stabilityMs未満＝短命
      latest(harness.streams).emitDisconnected();

      // 期待した待機時間ちょうどで次のストリームが張られる
      vi.advanceTimersByTime(delay - 1);
      expect(harness.streams).toHaveLength(streamCountBefore);
      vi.advanceTimersByTime(1);
      expect(harness.streams).toHaveLength(streamCountBefore + 1);

      latest(harness.streams).emitConnected();
    }
  });

  it("resets the backoff after a connection stays stable", () => {
    const { client, harness, logger } = makeClient();
    client.connect(() => {});

    // まず1回フラップさせて attempt を進める
    latest(harness.streams).emitConnected();
    vi.advanceTimersByTime(100);
    latest(harness.streams).emitDisconnected();
    vi.advanceTimersByTime(1000); // attempt=0の1000ms後に再接続
    expect(harness.streams).toHaveLength(2);

    // 今度は安定させる（stabilityMs以上つなぎ続ける）
    latest(harness.streams).emitConnected();
    vi.advanceTimersByTime(60000);
    expect(logger.infos.some((m) => m.includes("フラッピング後に接続が安定した"))).toBe(true);

    // 安定後の単発切断は attempt=0 に戻り、バックオフは基準値(1000ms)から
    const streamCountBefore = harness.streams.length;
    latest(harness.streams).emitDisconnected();
    vi.advanceTimersByTime(999);
    expect(harness.streams).toHaveLength(streamCountBefore);
    vi.advanceTimersByTime(1);
    expect(harness.streams).toHaveLength(streamCountBefore + 1);
  });

  it("warns once on the first flap and again at the threshold, throttling the middle", () => {
    const { client, harness, logger } = makeClient();
    client.connect(() => {});
    latest(harness.streams).emitConnected();

    const delays = [1000, 2000, 4000];
    for (let i = 0; i < delays.length; i++) {
      vi.advanceTimersByTime(100);
      latest(harness.streams).emitDisconnected();
      vi.advanceTimersByTime(delays[i] as number);
      latest(harness.streams).emitConnected();
    }

    const flapWarns = logger.warns.filter((m) => m.includes("切断された") || m.includes("フラッピング"));
    // 1回目: 「切断された」警告 / 2回目: debugへ間引き / 3回目(閾値): 「フラッピングを検知」警告
    expect(logger.warns.some((m) => m.includes("ストリームが切断された"))).toBe(true);
    expect(logger.warns.some((m) => m.includes("フラッピングを検知（3回連続"))).toBe(true);
    expect(flapWarns).toHaveLength(2);
  });

  it("stops all timers and does not reconnect after disconnect()", () => {
    const { client, harness } = makeClient();
    client.connect(() => {});
    const first = latest(harness.streams);
    first.emitConnected();

    client.disconnect();
    expect(first.closed).toBe(true);

    // pingもタイマーも止まり、以後のイベントで再接続もしない
    const pingsAtStop = first.pingCount;
    vi.advanceTimersByTime(120000);
    expect(first.pingCount).toBe(pingsAtStop);
    expect(harness.streams).toHaveLength(1);

    // 停止後にストリームが切断イベントを出しても再接続しない
    first.emitDisconnected();
    vi.advanceTimersByTime(60000);
    expect(harness.streams).toHaveLength(1);
  });
});

describe("MisskeyClient chat message reception", () => {
  it("survives a myUserId API failure without crashing and retries on the next message", async () => {
    const harness = createStreamHarness();
    const logger = createSpyLogger();
    const client = new MisskeyClient({
      host: "https://example.test",
      token: "token",
      keepalive: KEEPALIVE,
      logger,
      createStream: harness.factory,
    });
    const received: IncomingChatMessage[] = [];
    client.connect(
      () => {},
      (message) => received.push(message),
    );
    const stream = latest(harness.streams);
    stream.emitConnected();

    // 1回目のi APIは失敗、2回目以降は成功するようにスタブする
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("api down"))
      .mockResolvedValue({ id: "bot-self" });
    (client as unknown as { api: { request: typeof request } }).api = { request };

    // 失敗時: unhandledRejectionにならず、warnを残してメッセージは破棄（replayが回収する前提）
    stream.emitChat({ id: "m1", fromUserId: "u1", toUserId: "bot-self", text: "hi", createdAt: "2026-01-01T00:00:00Z" });
    await vi.waitFor(() => expect(logger.warns.some((m) => m.includes("自ユーザーIDの取得に失敗"))).toBe(true));
    expect(received).toEqual([]);

    // 失敗したPromiseがキャッシュされず、次のメッセージで再試行して届く
    stream.emitChat({ id: "m2", fromUserId: "u1", toUserId: "bot-self", text: "again", createdAt: "2026-01-01T00:01:00Z" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.id).toBe("m2");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("ignores messages echoed back from the bot itself", async () => {
    const harness = createStreamHarness();
    const client = new MisskeyClient({
      host: "https://example.test",
      token: "token",
      keepalive: KEEPALIVE,
      createStream: harness.factory,
      logger: createSpyLogger(),
    });
    const received: IncomingChatMessage[] = [];
    client.connect(
      () => {},
      (message) => received.push(message),
    );
    const stream = latest(harness.streams);
    stream.emitConnected();

    const request = vi.fn().mockResolvedValue({ id: "bot-self" });
    (client as unknown as { api: { request: typeof request } }).api = { request };

    stream.emitChat({ id: "m1", fromUserId: "bot-self", toUserId: "u1", text: "echo", createdAt: "2026-01-01T00:00:00Z" });
    stream.emitChat({ id: "m2", fromUserId: "u1", toUserId: "bot-self", text: "hi", createdAt: "2026-01-01T00:01:00Z" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.id).toBe("m2");
    // 自ユーザーIDのPromiseは成功時にキャッシュされ、i APIは1回しか呼ばれない
    expect(request).toHaveBeenCalledTimes(1);
  });
});
