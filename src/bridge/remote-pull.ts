import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Exec = (command: string, options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>;

export interface RemotePullOptions {
  gceProject: string;
  gceZone: string;
  gceInstance: string;
  remoteDigestPath: string;
  localDigestPath: string;
  gcloudPathOverride?: string;
  localAppData?: string;
  /** テスト差し替え用（既定: node:child_process の spawnSync） */
  exec?: Exec;
}

export interface RemotePullResult {
  localDigestPath: string;
  content: string;
}

// shell:true + 配列引数はNodeがクォートせず単純結合するため、パスにスペースを含む
// Windowsのインストール先（"...\Google\Cloud SDK\..."）が壊れる。そのため常に
// 自前でダブルクォートした1本のコマンド文字列を組み立ててからshellへ渡す。
function quote(value: string): string {
  return `"${value}"`;
}

/** VMにインストールされたgcloud CLIのパスを解決する（PATH → Windowsの既定インストール先の順） */
export function resolveGcloudPath(
  options: Pick<RemotePullOptions, "gcloudPathOverride" | "localAppData" | "exec">,
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

/**
 * 本番VM（GCE）はGitHubへの書き戻し経路を持たないため、VM上でBotが生成した
 * bot-digest.md はローカルの同名ファイルと自動では同期されない。
 * gcloud compute ssh 経由でVM上のファイルを読み取り専用で取得し、ローカルへ上書きする。
 */
export function pullRemoteDigest(options: RemotePullOptions): RemotePullResult {
  const exec = options.exec ?? spawnSync;
  const gcloud = resolveGcloudPath(options);

  const commandLine = [
    quote(gcloud),
    "compute",
    "ssh",
    options.gceInstance,
    `--zone=${options.gceZone}`,
    `--project=${options.gceProject}`,
    "--tunnel-through-iap",
    quote(`--command=sudo cat ${options.remoteDigestPath}`),
  ].join(" ");

  const result = exec(commandLine, { encoding: "utf8", shell: true });

  if (result.status !== 0 || !result.stdout?.trim()) {
    throw new Error(`VMからのbot-digest.md取得に失敗した: ${result.stderr || result.stdout || "(出力なし)"}`);
  }

  mkdirSync(dirname(options.localDigestPath), { recursive: true });
  writeFileSync(options.localDigestPath, result.stdout, "utf8");

  return { localDigestPath: options.localDigestPath, content: result.stdout };
}
