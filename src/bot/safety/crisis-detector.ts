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
