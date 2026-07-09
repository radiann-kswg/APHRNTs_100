export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema（object型）。プロバイダーごとの形式差はAIProvider実装側で吸収する。 */
  inputSchema: Record<string, unknown>;
}

export interface ToolInvocation {
  name: string;
  input: Record<string, unknown>;
  /** ハンドラがモデルに返した結果テキスト */
  result: string;
}

export interface GenerateReplyParams {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** tool_useが発生した際に呼ばれ、実行結果テキストを返す。AIProvider実装がこれを使って会話を続行する。 */
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
}

export interface GenerateReplyResult {
  text: string;
  toolInvocations: ToolInvocation[];
}

export interface AIProvider {
  readonly name: "anthropic" | "openai" | "gemini";
  generateReply(params: GenerateReplyParams): Promise<GenerateReplyResult>;
}
