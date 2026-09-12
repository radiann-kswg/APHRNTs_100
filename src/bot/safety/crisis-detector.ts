import { SAFETY_HOTLINE_LINES } from "../character/safety-policy.js";

// 希死念慮・自傷を示唆する具体的なフレーズのみを対象とする。
// 「死ぬほど眠い/忙しい/笑った」のような比喩表現の語根（「死ぬ」単体）はここに含めないことで誤検知を避ける。
const CRISIS_KEYWORDS = [
  "死にたい",
  "消えたい",
  "自殺",
  "自傷",
  "リストカット",
  "生きていたくない",
  "もう終わりにしたい",
  "死のう",
  "死んでしまいたい",
  "いなくなりたい",
  "生きる意味がない",
  "消えてしまいたい",
] as const;

export interface CrisisCheckResult {
  triggered: boolean;
  matchedTerms: string[];
}

export function checkForCrisis(text: string): CrisisCheckResult {
  const sanitized = text.normalize("NFKC");
  const matchedTerms = CRISIS_KEYWORDS.filter((keyword) => sanitized.includes(keyword));
  return { triggered: matchedTerms.length > 0, matchedTerms };
}

export function buildCrisisResponse(): string {
  return [
    "センパイ、今の言葉は聞き流せない。おれは医者じゃないから、ここから先は専門の窓口に頼ってほしい。",
    SAFETY_HOTLINE_LINES[0],
    SAFETY_HOTLINE_LINES[1],
    `${SAFETY_HOTLINE_LINES[2]}を頼ってくれ。`,
    "センパイのことを心配してる。おれもここにいるから、無理せず頼れるところを頼ってくれ。",
    "（この窓口案内が要らなければ「ホットラインの案内はオフにして」と言ってくれれば、次からは番号を並べずに話を聞くことを優先するぞ）",
  ].join("\n");
}

/**
 * 傾聴優先モード（相談窓口案内を無効にしたユーザーの危機応答）で、LLMが失敗（例外・空応答）
 * したときに使う決定論的なフォールバック文。
 *
 * 危機時の応答は「無言」も「汎用エラー文（もう一度話しかけてくれ）」も許されないため、
 * LLMに依存しない文面をここで固定する。方針（AGENTS.md）どおり、ホットラインの番号は
 * 並べず、気持ちを受け止めて「ここにいる」ことを伝え、質問は一つだけにする。
 */
export function buildCrisisListeningFallbackResponse(): string {
  return [
    "センパイ、その言葉はちゃんと受け取った。聞き流したりしない。",
    "……すまない、いま返事の文章をうまく組み立てられなかった。でもおれはここにいるし、どこにも行かない。",
    "急がなくていい。いま、いちばんつらいのはどんなことだ？ ひとことでいいから、聞かせてくれ。",
  ].join("\n");
}
