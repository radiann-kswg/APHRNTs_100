import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface HeartbeatState {
  wsConnected: boolean;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  startedAt: string;
  /** プロセス起動後にWS再接続が成立した回数（累計） */
  reconnectCount: number;
  /** 直近1時間のWS切断回数。watchdogが「切れては繋ぎ直し」の頻発（churn）を検知するために使う */
  disconnectsLastHour: number;
}

export interface HeartbeatWriter {
  start(): void;
  stop(): void;
}

export function createHeartbeatWriter(
  path: string,
  intervalMs: number,
  getState: () => HeartbeatState,
): HeartbeatWriter {
  let timer: NodeJS.Timeout | null = null;

  function writeOnce(): void {
    mkdirSync(dirname(path), { recursive: true });
    const state = getState();
    const payload = {
      ts: new Date().toISOString(),
      wsConnected: state.wsConnected,
      lastConnectedAt: state.lastConnectedAt,
      lastDisconnectedAt: state.lastDisconnectedAt,
      reconnectCount: state.reconnectCount,
      disconnectsLastHour: state.disconnectsLastHour,
      uptimeSec: Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000),
    };
    writeFileSync(path, JSON.stringify(payload, null, 2));
  }

  return {
    start(): void {
      writeOnce();
      timer = setInterval(writeOnce, intervalMs);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
