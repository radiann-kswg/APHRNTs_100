import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface HeartbeatState {
  wsConnected: boolean;
  lastConnectedAt: string | null;
  startedAt: string;
}

export interface HeartbeatWriter {
  start(): void;
  stop(): void;
}

// 小さなユーティリティ。今回のスコープではウォッチドッグ等の消費者は配線しない。
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
