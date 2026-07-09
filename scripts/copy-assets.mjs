// tscはTS以外のファイルをdist/へコピーしないため、実行時に必要な非TSアセット（schema.sql）を
// ビルド後にdist/へ複製するための小さなスクリプト。
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url)) + "/..";
const assets = [["src/storage/schema.sql", "dist/storage/schema.sql"]];

for (const [from, to] of assets) {
  const destDir = dirname(join(rootDir, to));
  mkdirSync(destDir, { recursive: true });
  copyFileSync(join(rootDir, from), join(rootDir, to));
}
