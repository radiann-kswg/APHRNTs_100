// Claude連携ブリッジの手動同期CLI。
//   ローカル内（logs/ ⇄ ローカルの .cache/session.db）:
//     npm run sync             … 双方向同期（logs/取り込み → ダイジェスト書き出し）
//     npm run sync:import      … Claude→Bot（logs/YYYY-MM-DD.md をSQLiteへ取り込み）
//     npm run sync:export      … Bot→Claude（SQLite記録を logs/bot-digest.md へ書き出し）
//     npm run sync:export -- --days=31  … ダイジェストの対象日数を一時的に上書き（月次振り返り準備等）
//   本番VM（GCE）との間（gcloud compute ssh / scp 経由）:
//     npm run sync:remote      … 相互同期（push-remote → VM側でダイジェスト再生成 → pull-remote）
//     npm run sync:push-remote … Claude→Bot（ローカルのlogs/をVMへ転送し、VM上で取り込み）
//     npm run sync:pull-remote … Bot→Claude（VM上のbot-digest.mdをローカルへ取得）
//     npm run sync:push-remote -- --days=14 … VMへ転送する日数を一時的に上書き（既定は直近7日）
import { fileURLToPath } from "node:url";
import type { Env } from "../config/env.js";
import { loadEnv } from "../config/env.js";
import { openDatabase } from "../storage/db.js";
import type { RemoteConnection } from "./remote-common.js";
import { pullRemoteDigest } from "./remote-pull.js";
import { pushRemoteLogs, type RemotePushResult } from "./remote-push.js";
import { syncRemote } from "./remote-sync.js";
import { runExport, runImport } from "./sync.js";

const LOCAL_MODES = ["sync", "import", "export"] as const;
const REMOTE_MODES = ["pull-remote", "push-remote", "sync-remote"] as const;
type Mode = (typeof LOCAL_MODES)[number] | (typeof REMOTE_MODES)[number];

const mode = process.argv[2] ?? "sync";
const daysArg = process.argv.slice(3).find((arg) => arg.startsWith("--days="));

export function parseDaysOverride(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number(raw.slice("--days=".length));
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`--days は正の整数で指定すること（指定値: ${raw}）`);
    process.exit(1);
  }
  return value;
}

function isMode(value: string): value is Mode {
  return (LOCAL_MODES as readonly string[]).includes(value) || (REMOTE_MODES as readonly string[]).includes(value);
}

/** VM上で実行したコマンドの出力を、ローカルの出力と区別できる形で表示する */
function printRemoteOutput(output: string | undefined): void {
  for (const line of (output ?? "").split("\n").filter((line) => line.trim().length > 0)) {
    console.log(`  [VM] ${line}`);
  }
}

function reportPush(result: RemotePushResult): void {
  if (result.pushedFiles.length === 0) {
    console.log(`[sync] ローカル→VM: ${result.sinceDate}以降の対象ログが無いため転送をスキップした。`);
    return;
  }
  console.log(
    `[sync] ローカル→VM: ${result.sinceDate}以降の${result.pushedFiles.length}件を ${result.remoteLogsDir} へ転送した（${result.pushedFiles.join(", ")}）。`,
  );
  printRemoteOutput(result.importOutput);
}

function runRemoteMode(mode: (typeof REMOTE_MODES)[number], env: Env, daysOverride: number | undefined): void {
  const connection: RemoteConnection = {
    gceProject: env.GCE_PROJECT,
    gceZone: env.GCE_ZONE,
    gceInstance: env.GCE_INSTANCE,
    gcloudPathOverride: env.GCLOUD_PATH || undefined,
    localAppData: process.env.LOCALAPPDATA,
  };
  const remote = {
    ...connection,
    localLogsDir: env.CLAUDE_LOGS_DIR,
    localDigestPath: env.BOT_DIGEST_PATH,
    remoteDigestPath: env.REMOTE_BOT_DIGEST_PATH,
    remoteBotUser: env.REMOTE_BOT_USER,
    days: daysOverride,
  };

  if (mode === "pull-remote") {
    const result = pullRemoteDigest(remote);
    console.log(`[sync] VM→ローカル: bot-digest.md を ${result.localDigestPath} へ取得した。`);
    return;
  }

  if (mode === "push-remote") {
    reportPush(pushRemoteLogs(remote));
    return;
  }

  const result = syncRemote(remote);
  reportPush(result.push);
  printRemoteOutput(result.exportOutput);
  console.log(`[sync] VM→ローカル: bot-digest.md を ${result.pull.localDigestPath} へ取得した。`);
}

function main(): void {
  if (!isMode(mode)) {
    console.error(
      `不明なモード: ${mode}（${[...LOCAL_MODES, ...REMOTE_MODES].join(" / ")} のいずれかを指定すること）`,
    );
    process.exit(1);
  }

  const env = loadEnv();
  const daysOverride = parseDaysOverride(daysArg);

  if (mode === "pull-remote" || mode === "push-remote" || mode === "sync-remote") {
    runRemoteMode(mode, env, daysOverride);
    return;
  }

  const db = openDatabase(env.DB_PATH);
  const deps = {
    db,
    logsDir: env.CLAUDE_LOGS_DIR,
    digestPath: env.BOT_DIGEST_PATH,
    digestDays: daysOverride ?? env.BOT_DIGEST_DAYS,
    ownerUserId: env.BOT_OWNER_USER_ID,
  };

  try {
    if (mode === "import" || mode === "sync") {
      const result = runImport(deps);
      console.log(
        `[sync] Claude→Bot: ${deps.logsDir}/ から ${result.imported}件のセッション記録を取り込んだ（スキップ ${result.skipped}件）。`,
      );
    }
    if (mode === "export" || mode === "sync") {
      const digestPath = runExport(deps);
      console.log(`[sync] Bot→Claude: 記録ダイジェストを ${digestPath} へ書き出した。`);
    }
  } finally {
    db.close();
  }
}

// テストからのimport時にはCLI本体を実行させず、直接スクリプト実行された場合のみ動かす
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
