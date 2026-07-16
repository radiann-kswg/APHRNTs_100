import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureRemoteSuccess, resolveRemoteRunner, type RemoteCommandOptions } from "./remote-common.js";

export interface RemotePullOptions extends RemoteCommandOptions {
  remoteDigestPath: string;
  localDigestPath: string;
}

export interface RemotePullResult {
  localDigestPath: string;
  content: string;
}

/**
 * 本番VM（GCE）はGitHubへの書き戻し経路を持たないため、VM上でBotが生成した
 * bot-digest.md はローカルの同名ファイルと自動では同期されない。
 * gcloud compute ssh 経由でVM上のファイルを読み取り専用で取得し、ローカルへ上書きする。
 */
export function pullRemoteDigest(options: RemotePullOptions): RemotePullResult {
  const runner = resolveRemoteRunner(options);
  const result = ensureRemoteSuccess(
    runner.ssh(`sudo cat ${options.remoteDigestPath}`),
    "VMからのbot-digest.md取得に失敗した",
  );

  // catが成功しても中身が空なら、VM側のダイジェスト生成が壊れている（ここだけ他経路と判定が異なる）
  if (!result.stdout?.trim()) {
    throw new Error("VMからのbot-digest.md取得に失敗した: (出力なし)");
  }

  mkdirSync(dirname(options.localDigestPath), { recursive: true });
  writeFileSync(options.localDigestPath, result.stdout, "utf8");

  return { localDigestPath: options.localDigestPath, content: result.stdout };
}
