import {
  DEFAULT_MISSKEY_PING_INTERVAL_MS,
  MISSKEY_FLAP_ALERT_THRESHOLD,
  MISSKEY_RECONNECT_BASE_MS,
  MISSKEY_RECONNECT_FACTOR,
  MISSKEY_RECONNECT_JITTER_RATIO,
  MISSKEY_RECONNECT_MAX_MS,
  MISSKEY_STABILITY_MS,
} from "../config/constants.js";

/**
 * Misskeyストリームの再接続バックオフ設定。
 * misskey-js内蔵のreconnecting-websocket（minReconnectionDelay=1ms）は
 * 数分ごとのアイドル切断に対して実効的なバックオフにならないため、
 * 切断時はネイティブ再接続を止めて本ポリシーで張り直す（src/misskey/client.ts参照）。
 */
export interface BackoffOptions {
  /** バックオフの基準待機時間（ms）。attempt=0のときの基礎値。 */
  baseMs: number;
  /** 1試行ごとに待機時間を何倍にするか（指数バックオフの底）。 */
  factor: number;
  /** 待機時間の上限（ms）。指数的な増加をここで頭打ちにする。 */
  maxMs: number;
  /** ジッタ幅の割合（0..1）。±この割合の一様乱数で待機時間を揺らす。 */
  jitterRatio: number;
}

/** keepalive（定期ping）と自前再接続の全体設定。 */
export interface KeepaliveOptions {
  /** アプリレベルのping送信間隔（ms）。サーバ/LBのアイドルタイムアウトより十分短くする。 */
  pingIntervalMs: number;
  /** 再接続の指数バックオフ設定。 */
  backoff: BackoffOptions;
  /** 接続がこの時間（ms）以上継続したら「安定」とみなし、バックオフ試行回数をリセットする。 */
  stabilityMs: number;
  /** 短時間切断（フラッピング）がこの回数連続したら警告ログを出す閾値。 */
  flapAlertThreshold: number;
}

export const DEFAULT_KEEPALIVE_OPTIONS: KeepaliveOptions = {
  pingIntervalMs: DEFAULT_MISSKEY_PING_INTERVAL_MS,
  backoff: {
    baseMs: MISSKEY_RECONNECT_BASE_MS,
    factor: MISSKEY_RECONNECT_FACTOR,
    maxMs: MISSKEY_RECONNECT_MAX_MS,
    jitterRatio: MISSKEY_RECONNECT_JITTER_RATIO,
  },
  stabilityMs: MISSKEY_STABILITY_MS,
  flapAlertThreshold: MISSKEY_FLAP_ALERT_THRESHOLD,
};

/** KeepaliveOptionsの部分指定。backoffだけを一部上書きすることも許す。 */
export type KeepaliveOverrides = Partial<Omit<KeepaliveOptions, "backoff">> & {
  backoff?: Partial<BackoffOptions>;
};

/** 部分指定を既定値にマージして完全なKeepaliveOptionsを得る。 */
export function resolveKeepaliveOptions(overrides?: KeepaliveOverrides): KeepaliveOptions {
  return {
    pingIntervalMs: overrides?.pingIntervalMs ?? DEFAULT_KEEPALIVE_OPTIONS.pingIntervalMs,
    stabilityMs: overrides?.stabilityMs ?? DEFAULT_KEEPALIVE_OPTIONS.stabilityMs,
    flapAlertThreshold:
      overrides?.flapAlertThreshold ?? DEFAULT_KEEPALIVE_OPTIONS.flapAlertThreshold,
    backoff: {
      baseMs: overrides?.backoff?.baseMs ?? DEFAULT_KEEPALIVE_OPTIONS.backoff.baseMs,
      factor: overrides?.backoff?.factor ?? DEFAULT_KEEPALIVE_OPTIONS.backoff.factor,
      maxMs: overrides?.backoff?.maxMs ?? DEFAULT_KEEPALIVE_OPTIONS.backoff.maxMs,
      jitterRatio: overrides?.backoff?.jitterRatio ?? DEFAULT_KEEPALIVE_OPTIONS.backoff.jitterRatio,
    },
  };
}

/**
 * attempt回目（0始まり）の再接続待機時間を、指数バックオフ＋上限＋ジッタで計算する。
 * @param attempt 直前の安定接続以降の連続再接続試行回数（0始まり）。
 * @param random 0以上1未満の乱数（既定 Math.random）。ジッタの符号・大きさを決める。
 * @returns 0以上に丸めた待機時間（ms）。
 */
export function computeBackoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: number,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const raw = options.baseMs * Math.pow(options.factor, safeAttempt);
  const capped = Math.min(raw, options.maxMs);
  // random∈[0,1) を [-1,1) に写像して ±jitterRatio の一様ジッタにする。
  const jitter = capped * options.jitterRatio * (random * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * 直前の接続が「短命（フラッピング相当）」だったかを判定する。
 * 一度も接続できていない（connectedAtMs===null）場合も、張り直しに失敗した扱いでtrueを返す。
 * @returns 接続継続時間が stabilityMs 未満なら true。
 */
export function isShortLivedConnection(
  connectedAtMs: number | null,
  disconnectedAtMs: number,
  stabilityMs: number,
): boolean {
  if (connectedAtMs === null) {
    return true;
  }
  return disconnectedAtMs - connectedAtMs < stabilityMs;
}
