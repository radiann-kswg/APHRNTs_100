// Claude連携ブリッジの手動同期CLI。
//   npm run sync          … 双方向同期（logs/取り込み → ダイジェスト書き出し）
//   npm run sync:import   … Claude→Bot（logs/YYYY-MM-DD.md をSQLiteへ取り込み）
//   npm run sync:export   … Bot→Claude（SQLite記録を logs/bot-digest.md へ書き出し）
import { loadEnv } from "../config/env.js";
import { openDatabase } from "../storage/db.js";
import { runExport, runImport, runSync } from "./sync.js";

const mode = process.argv[2] ?? "sync";

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

main();
