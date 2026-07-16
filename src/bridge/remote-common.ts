import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { join, posix } from "node:path";

export type Exec = (command: string, options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>;

/** 本番VM（GCE）への接続情報。pull-remote / push-remote / sync-remote で共通に使う */
export interface RemoteConnection {
  gceProject: string;
  gceZone: string;
  gceInstance: string;
  gcloudPathOverride?: string;
  localAppData?: string;
  /** テスト差し替え用（既定: node:child_process の spawnSync） */
  exec?: Exec;
}

export interface RemoteCommandOptions extends RemoteConnection {
  /**
   * 生成済みの実行系。省略時は接続情報から都度生成する。
   * sync-remote のように複数のgcloudコマンドを続けて実行する場合に渡すと、
   * gcloudパスの解決（--versionによる探索）を1回で済ませられる。
   */
  runner?: RemoteRunner;
}

/** VM上でのコマンド実行・VMへのファイル転送を行う実行系 */
export interface RemoteRunner {
  /** VM上で1つのコマンドを実行する（gcloud compute ssh --command） */
  ssh(remoteCommand: string): SpawnSyncReturns<string>;
  /**
   * ローカルのファイルをVMへ転送する（gcloud compute scp）。
   * fileNames は cwd からの相対ファイル名、remoteDest はVMのSSHユーザーのホーム基準の相対パス。
   */
  scp(fileNames: string[], remoteDest: string, cwd: string): SpawnSyncReturns<string>;
}

// shell:true + 配列引数はNodeがクォートせず単純結合するため、パスにスペースを含む
// Windowsのインストール先（"...\Google\Cloud SDK\..."）が壊れる。そのため常に
// 自前でダブルクォートした1本のコマンド文字列を組み立ててからshellへ渡す。
export function quote(value: string): string {
  return `"${value}"`;
}

/** gcloud CLIのパスを解決する（PATH → Windowsの既定インストール先の順） */
export function resolveGcloudPath(
  options: Pick<RemoteConnection, "gcloudPathOverride" | "localAppData" | "exec">,
): string {
  const exec = options.exec ?? spawnSync;
  const candidates = [
    options.gcloudPathOverride,
    "gcloud",
    options.localAppData && join(options.localAppData, "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const probe = exec(`${quote(candidate)} --version`, { encoding: "utf8", stdio: "ignore", shell: true });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  throw new Error(
    "gcloud CLIが見つからない。Google Cloud SDKをインストールするか、GCLOUD_PATH環境変数でgcloud.cmdの場所を指定してください。",
  );
}

/** 接続情報からVM上のssh実行・VMへのscp転送を行う実行系を生成する（gcloudパスの解決はここで1回だけ行う） */
export function createRemoteRunner(connection: RemoteConnection): RemoteRunner {
  const exec = connection.exec ?? spawnSync;
  const gcloud = resolveGcloudPath(connection);
  const flags = [`--zone=${connection.gceZone}`, `--project=${connection.gceProject}`, "--tunnel-through-iap"];

  return {
    ssh(remoteCommand: string): SpawnSyncReturns<string> {
      const commandLine = [
        quote(gcloud),
        "compute",
        "ssh",
        connection.gceInstance,
        ...flags,
        quote(`--command=${remoteCommand}`),
      ].join(" ");
      return exec(commandLine, { encoding: "utf8", shell: true });
    },

    scp(fileNames: string[], remoteDest: string, cwd: string): SpawnSyncReturns<string> {
      const commandLine = [
        quote(gcloud),
        "compute",
        "scp",
        ...fileNames,
        `${connection.gceInstance}:${remoteDest}`,
        ...flags,
      ].join(" ");
      return exec(commandLine, { encoding: "utf8", shell: true, cwd });
    },
  };
}

export function resolveRemoteRunner(options: RemoteCommandOptions): RemoteRunner {
  return options.runner ?? createRemoteRunner(options);
}

/** gcloudコマンドの実行結果を検証し、失敗していればstderrを添えて投げる */
export function ensureRemoteSuccess(result: SpawnSyncReturns<string>, message: string): SpawnSyncReturns<string> {
  if (result.error || result.status !== 0) {
    throw new Error(`${message}: ${result.stderr || result.stdout || result.error?.message || "(出力なし)"}`);
  }
  return result;
}

export interface RemoteRepoPaths {
  /** VM上のリポジトリのルート（例: /opt/aphrnts-100） */
  repoDir: string;
  /** VM上のログディレクトリ（例: /opt/aphrnts-100/logs） */
  logsDir: string;
}

/**
 * VM上のリポジトリ構成を `REMOTE_BOT_DIGEST_PATH` から導出する。
 *
 * VM側のBotは `<リポジトリ>/logs/bot-digest.md`（`BOT_DIGEST_PATH` の既定値）を生成するため、
 * ダイジェストのパスからログディレクトリとリポジトリルートが一意に決まる。
 * 接続情報のハードコード・設定項目の二重管理を増やさないよう、push側もこの導出結果を使う。
 */
export function resolveRemoteRepoPaths(remoteDigestPath: string): RemoteRepoPaths {
  const logsDir = posix.dirname(remoteDigestPath);
  const repoDir = posix.dirname(logsDir);
  // logsDirが "/" になる場合もrepoDirは "/" になるため、この2条件で
  // 「絶対パスであること」「リポジトリのルートがファイルシステムの根でないこと」を満たせる
  if (!posix.isAbsolute(remoteDigestPath) || repoDir === "/") {
    throw new Error(
      `REMOTE_BOT_DIGEST_PATH はVM上のリポジトリ内の絶対パス（例: /opt/aphrnts-100/logs/bot-digest.md）で指定すること（指定値: ${remoteDigestPath}）`,
    );
  }
  return { repoDir, logsDir };
}
