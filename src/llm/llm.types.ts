/** Minimal subset of the OpenAI Chat Completions wire format that AURA relies on. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
}

export interface ChatResult {
  message: Extract<ChatMessage, { role: 'assistant' }>;
  finishReason: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/** Anything that can answer a chat request — swap in a fake for tests. */
export abstract class LlmClient {
  abstract readonly model: string;
  abstract chat(request: ChatRequest): Promise<ChatResult>;
  abstract ping(): Promise<void>;
}
