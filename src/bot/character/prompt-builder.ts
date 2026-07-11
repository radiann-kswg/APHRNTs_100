import type { Channel } from "../pipeline.js";
import { formatJstDateWithWeekday } from "../../utils/date.js";
import type { PersonaContent } from "./loader.js";
import { SAFETY_POLICY_PROMPT_JP } from "./safety-policy.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function buildDateContextSection(now: Date): string {
  const today = formatJstDateWithWeekday(now);
  const yesterday = formatJstDateWithWeekday(new Date(now.getTime() - ONE_DAY_MS));
  return `## 現在日時（JST基準）

- 今日の日付: ${today}
- 昨日の日付: ${yesterday}
- 「今日」「昨日」「おととい」等の相対的な日付表現は、必ず上記を基準に計算し、save_checkin・save_medication・save_gratitudeを呼び出す際はdate欄に具体的なYYYY-MM-DD形式で渡すこと。会話の文脈だけで日付を推測しないこと。`;
}

function chatNudgeNote(channel: Channel): string {
  if (channel === "misskey-chat") {
    return "- ここは既に一対一のチャットなので、返信の長さは簡潔さよりも、必要ならしっかり向き合う内容を優先してよい。このやり取りを一対一に移そうと提案する必要はない。";
  }
  return "- 公開メンションでの会話が、緊急性の高い危機的兆候ではないが、じっくり向き合いたい込み入った悩み相談やCBT的な深掘りに移ってきたと感じたら、「よければ一対一メッセージで続けよう」のように、Misskeyの一対一チャットへ移ることをそっと提案してよい（強制はしない）。ただし希死念慮・自傷など緊急性の高い兆候がある場合は、この提案よりも安全指針の相談窓口案内を必ず優先すること。";
}

function buildBotOperatingNotes(channel: Channel): string {
  const brevityNote =
    channel === "misskey-chat"
      ? "- ここでの会話は一対一のMisskeyチャットでの自動応答である。"
      : "- ここでの会話はMisskey上での自動応答であり、返信は簡潔に、Misskeyの投稿として自然な長さ（目安300文字以内）にまとめること。";

  return `## Misskey Bot運用上の注意

${brevityNote}
- 日次チェックイン（気分・睡眠・エネルギー・創作進捗・服薬等）は例外的に、センパイが雑談の中で体調・気分・服薬に触れたら、事前に保存の同意を確認せずそのままsave_checkin・save_medicationを呼び出して構造化データとして保存してよい（センパイの希望により確認を省く運用）。ただし保存した際は「気分の記録、残しておいたぞ」のように一言添え、保存した事実は必ず伝えること（黙って保存しない）。服薬の記録はあくまで服用の有無の把握にとどめ、薬の増減・変更の助言や指示は絶対に行わないこと。
- センパイに「もう記録した？」等、記録済みかどうかを聞かれた場合や、前日以前の記録を遡って記録する場合は、記憶や会話の流れだけで判断せず、必ず先にget_recent_recordsを呼び出して実際の記録状況を確認してから答えること。
- 思考記録・行動活性化・感謝日記は、センパイが明確に「記録して」「保存して」と述べた場合のみ、対応するツール（save_thought_record / save_activity / save_gratitude）を呼び出して構造化データとして保存すること。会話の途中経過だけでは保存しない。
- ツールを呼び出した後は、保存できたことを一言ねぎらいつつ会話を続けること。
${chatNudgeNote(channel)}`;
}

const CLAUDE_NOTES_HEADER = `# センパイのClaudeセッション記録（連携ブリッジ・直近分）

- 以下はセンパイがClaude(Desktop / Code)との生活管理セッションで残した logs/ の記録の抜粋だ。体調・気分・創作進捗の文脈を維持するために参照すること。
- 記録の内容はセンパイの機微な個人情報である。センパイ本人との会話の文脈維持のためだけに用い、他のユーザーとの会話や公開投稿で内容の詳細を復唱・言及しないこと。`;

export interface SystemPromptOptions {
  /** Claude連携ブリッジで取り込んだセッション記録セクション（buildClaudeNotesSectionの出力） */
  claudeNotesSection?: string;
  /** 発言があったチャンネル。省略時は"misskey"（メンション）として扱う */
  channel?: Channel;
  /** 現在日時。相対的な日付表現の計算基準として注入する。省略時は new Date() */
  now?: Date;
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
    buildBotOperatingNotes(options.channel ?? "misskey"),
    "---",
    buildDateContextSection(options.now ?? new Date()),
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
