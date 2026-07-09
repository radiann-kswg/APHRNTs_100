import { CLAUDE_BRIDGE_NOTE_MAX_CHARS } from "../config/constants.js";
import type { ClaudeNoteRow } from "../storage/claude-notes-store.js";

/**
 * claude_session_notes の行から、Botのシステムプロンプトへ注入する
 * 「センパイのClaudeセッション記録」セクション本文を組み立てる。
 * 記録がない場合は undefined を返す（セクション自体を出さない）。
 */
export function buildClaudeNotesSection(
  rows: ClaudeNoteRow[],
  maxCharsPerNote: number = CLAUDE_BRIDGE_NOTE_MAX_CHARS,
): string | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const sections = rows.map((row) => {
    const content =
      row.content.length > maxCharsPerNote
        ? `${row.content.slice(0, maxCharsPerNote)}\n…（以降省略）`
        : row.content;
    return `### ${row.date}\n\n${content.trim()}`;
  });
  return sections.join("\n\n");
}
