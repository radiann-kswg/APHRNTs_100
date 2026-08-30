import type { ToolDefinition } from "../../ai/provider.js";

/**
 * 応答本文に「XMLテキストとして漏出したツール呼び出し」を検出・回収するモジュール。
 *
 * 背景: LLMがツール呼び出しを正規のAPI形式（tool_use等）ではなく、
 * `<function_calls><invoke name="...">...` というXML風テキストとして本文に
 * 書いてしまうことが稀にある（2026-08-30に一対一チャットで実際に発生。
 * 生XMLがそのまま投稿され、保存も実行されなかった）。
 * ここで本文からパースして本来のツール実行に回し、本文からは除去する。
 *
 * 実例に合わせた耐性:
 * - 引用符はスマート引用符（“ ”）やシングルも許容する
 * - `antml:` 名前空間プレフィックスの有無を問わない
 * - 出力トークン上限で末尾が切れたXMLは、完結したinvokeだけ回収し残骸は捨てる
 */

export interface SalvagedCall {
  name: string;
  input: Record<string, unknown>;
}

export interface SalvageResult {
  /** 漏出XMLを除去した本文（前後trim済み） */
  text: string;
  /** 回収できた（完結していた）ツール呼び出し */
  calls: SalvagedCall[];
}

const Q = `["'“”]`;
const MARKER_RE = /<(?:antml:)?(?:function_calls|invoke)\b/;

function invokeRe(): RegExp {
  return new RegExp(`<(?:antml:)?invoke\\s+name=${Q}([^"'“”>]+)${Q}\\s*>([\\s\\S]*?)</(?:antml:)?invoke>`, "g");
}

function paramRe(): RegExp {
  return new RegExp(
    `<(?:antml:)?parameter\\s+name=${Q}([^"'“”>]+)${Q}\\s*>([\\s\\S]*?)</(?:antml:)?parameter>`,
    "g",
  );
}

export function containsLeakedToolCallMarkup(text: string): boolean {
  return MARKER_RE.test(text);
}

/** inputSchemaのproperty型に合わせて、XML内の文字列値を実際の型へ変換する */
function coerceValue(schemaType: unknown, raw: string): unknown {
  const trimmed = raw.trim();
  if (schemaType === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    return undefined;
  }
  if (schemaType === "integer" || schemaType === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return trimmed;
}

/**
 * 漏出XMLをパースし、既知ツールへの完結した呼び出しと、XMLを除去した本文を返す。
 * ツールの実行自体は呼び出し側（pipeline）が行う。
 */
export function salvageLeakedToolCalls(text: string, tools: ToolDefinition[]): SalvageResult {
  const schemaByTool = new Map(
    tools.map((tool) => {
      const properties = (tool.inputSchema as { properties?: Record<string, { type?: unknown }> }).properties ?? {};
      return [tool.name, properties] as const;
    }),
  );

  const calls: SalvagedCall[] = [];
  for (const match of text.matchAll(invokeRe())) {
    const toolName = match[1] ?? "";
    const body = match[2] ?? "";
    const properties = schemaByTool.get(toolName);
    if (!properties) continue; // 未知のツール名は実行に回さない（本文からの除去は下で行う）

    const input: Record<string, unknown> = {};
    for (const param of body.matchAll(paramRe())) {
      const paramName = param[1] ?? "";
      const value = coerceValue(properties[paramName]?.type, param[2] ?? "");
      if (value !== undefined) {
        input[paramName] = value;
      }
    }
    calls.push({ name: toolName, input });
  }

  let cleaned = text.replace(/<\/?(?:antml:)?function_calls>/g, "").replace(invokeRe(), "");
  // 途中で切れたXML（閉じタグのない残骸）は、開始マーカー以降をまとめて捨てる
  const dangling = cleaned.search(MARKER_RE);
  if (dangling >= 0) {
    cleaned = cleaned.slice(0, dangling);
  }

  return { text: cleaned.trim(), calls };
}
