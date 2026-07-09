// Claude連携ブリッジの手動同期CLI。
//   npm run sync          … 双方向同期（logs/取り込み → ダイジェスト書き出し）
//   npm run sync:import   … Claude→Bot（logs/YYYY-MM-DD.md をSQLiteへ取り込み）
//   npm run sync:export   … Bot→Claude（SQLite記録を logs/bot-digest.md へ書き出し）
//   npm run sync:export -- --days=31  … ダイジェストの対象日数を一時的に上書き（月次振り返り準備等）
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { openDatabase } from "../storage/db.js";
import { runExport, runImport } from "./sync.js";

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

function main(): void {
  if (mode !== "sync" && mode !== "import" && mode !== "export") {
    console.error(`不明なモード: ${mode}（sync / import / export のいずれかを指定すること）`);
    process.exit(1);
  }

  const env = loadEnv();
  const db = openDatabase(env.DB_PATH);
  const deps = {
    db,
    logsDir: env.CLAUDE_LOGS_DIR,
    digestPath: env.BOT_DIGEST_PATH,
    digestDays: parseDaysOverride(daysArg) ?? env.BOT_DIGEST_DAYS,
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
