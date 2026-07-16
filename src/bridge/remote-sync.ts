import {
  ensureRemoteSuccess,
  resolveRemoteRepoPaths,
  resolveRemoteRunner,
  type RemoteCommandOptions,
} from "./remote-common.js";
import { pullRemoteDigest, type RemotePullResult } from "./remote-pull.js";
import { pushRemoteLogs, type RemotePushOptions, type RemotePushResult } from "./remote-push.js";

export interface RemoteExportOptions extends RemoteCommandOptions {
  /** VM上のbot-digest.mdのパス。ここからVMのリポジトリを導出する */
  remoteDigestPath: string;
  /** VM上でBotを実行しているユーザー（sync:exportの実行者） */
  remoteBotUser: string;
}

export interface RemoteSyncOptions extends RemotePushOptions {
  /** 取得したダイジェストの保存先（既定: logs/bot-digest.md） */
  localDigestPath: string;
}

export interface RemoteSyncResult {
  push: RemotePushResult;
  /** VM上で実行した sync:export の出力 */
  exportOutput: string;
  pull: RemotePullResult;
}

/**
 * VM上で sync:export を実行し、VMのSQLite（Misskey側の記録）から
 * VMの logs/bot-digest.md を再生成する。ダイジェストの対象日数はVM側の
 * BOT_DIGEST_DAYS に従う（ローカルの設定・--days は影響しない）。
 */
export function runRemoteExport(options: RemoteExportOptions): string {
  const { repoDir } = resolveRemoteRepoPaths(options.remoteDigestPath);
  const runner = resolveRemoteRunner(options);
  const result = ensureRemoteSuccess(
    runner.ssh(`sudo -u ${options.remoteBotUser} bash -c 'cd ${repoDir} && npm run sync:export'`),
    "VM上でのダイジェスト再生成(sync:export)に失敗した",
  );
  return result.stdout?.trim() ?? "";
}

/**
 * ローカル⇄本番VMの相互同期。
 *   1. push-remote: ローカルの logs/YYYY-MM-DD.md をVMへ転送し、VMのSQLiteへ取り込む
 *   2. VM側export: 取り込み後のVMのSQLiteから logs/bot-digest.md を再生成する
 *   3. pull-remote: VMの logs/bot-digest.md をローカルへ取得する
 * ローカル内で完結する `npm run sync`（logs/ ⇄ ローカルのSQLite）とは対象が異なる。
 */
export function syncRemote(options: RemoteSyncOptions): RemoteSyncResult {
  // gcloudパスの解決（--versionによる探索）を1回で済ませるため、実行系を3経路で共有する
  const runner = resolveRemoteRunner(options);
  const push = pushRemoteLogs({ ...options, runner });
  const exportOutput = runRemoteExport({ ...options, runner });
  const pull = pullRemoteDigest({ ...options, runner });
  return { push, exportOutput, pull };
}
