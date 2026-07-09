import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CbtDatasFile {
  filename: string;
  content: string;
}

export interface PersonaContent {
  roleplayPrompt: string;
  cbtDatas: CbtDatasFile[];
}

function findRepoRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // src/bot/character/loader.ts (または dist/bot/character/loader.js) から3階層上がリポジトリルート
  return resolve(moduleDir, "..", "..", "..");
}

export function loadPersonaContent(repoRoot: string = findRepoRoot()): PersonaContent {
  const roleplayPrompt = readFileSync(
    join(repoRoot, ".roleplay-datas", "roleplay-prompt.md"),
    "utf8",
  );

  const cbtDir = join(repoRoot, ".cbt-datas");
  const filenames = readdirSync(cbtDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  const cbtDatas = filenames.map((filename) => ({
    filename,
    content: readFileSync(join(cbtDir, filename), "utf8"),
  }));

  return { roleplayPrompt, cbtDatas };
}
