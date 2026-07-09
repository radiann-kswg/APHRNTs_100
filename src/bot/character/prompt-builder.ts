import type { PersonaContent } from "./loader.js";
import { SAFETY_POLICY_PROMPT_JP } from "./safety-policy.js";

const BOT_OPERATING_NOTES = `## Misskey Bot運用上の注意

- ここでの会話はMisskey上での自動応答であり、返信は簡潔に、Misskeyの投稿として自然な長さ（目安300文字以内）にまとめること。
- センパイが日次チェックイン・思考記録・行動活性化・感謝日記の内容を明確に「記録して」「保存して」と述べた場合のみ、対応するツール（save_checkin / save_thought_record / save_activity / save_gratitude）を呼び出して構造化データとして保存すること。会話の途中経過だけでは保存しない。
- ツールを呼び出した後は、保存できたことを一言ねぎらいつつ会話を続けること。`;

const CLAUDE_NOTES_HEADER = `# センパイのClaudeセッション記録（連携ブリッジ・直近分）

- 以下はセンパイがClaude(Desktop / Code)との生活管理セッションで残した logs/ の記録の抜粋だ。体調・気分・創作進捗の文脈を維持するために参照すること。
- 記録の内容はセンパイの機微な個人情報である。センパイ本人との会話の文脈維持のためだけに用い、他のユーザーとの会話や公開投稿で内容の詳細を復唱・言及しないこと。`;

export interface SystemPromptOptions {
  /** Claude連携ブリッジで取り込んだセッション記録セクション（buildClaudeNotesSectionの出力） */
  claudeNotesSection?: string;
}

export function buildSystemPrompt(persona: PersonaContent, options: SystemPromptOptions = {}): string {
  const cbtSections = persona.cbtDatas
    .map((file) => `<!-- .cbt-datas/${file.filename} -->\n${file.content}`)
    .join("\n\n---\n\n");

  const parts = [
    persona.roleplayPrompt,
    "---",
    SAFETY_POLICY_PROMPT_JP,
    "---",
    "# CBTセルフケア機能ガイド（.cbt-datas/）",
    cbtSections,
    "---",
    BOT_OPERATING_NOTES,
  ];

  if (options.claudeNotesSection) {
    parts.push(
      "---",
      CLAUDE_NOTES_HEADER,
      `<claude-session-notes>\n${options.claudeNotesSection}\n</claude-session-notes>`,
    );
  }

  return parts.join("\n\n");
}
