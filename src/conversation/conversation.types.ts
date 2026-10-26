import type { ChatMessage } from '../llm/llm.types';

export interface ConverseInput {
  text: string;
  conversationId?: string;
  speaker?: string;
  room?: string;
  language?: string;
  /** Fingerprint of the API key that made the request. */
  client?: string;
  /** Client-provided history (OpenAI/Ollama-compatible endpoints) — overrides stored history. */
  history?: ChatMessage[];
}

export interface ActionRecord {
  tool: string;
  arguments: unknown;
  status: 'ok' | 'error' | 'pending_confirmation';
  result?: unknown;
}

export type Route = 'llm' | 'fast_path' | 'confirmation';

export interface ConverseResult {
  conversationId: string;
  text: string;
  /** How the answer was produced. */
  route: Route;
  /** Language the answer is in (detected per utterance unless overridden). */
  language: string;
  principal: { profile: string; resolvedBy: string; speaker?: string; room?: string };
  actions: ActionRecord[];
  pendingConfirmation: { id: string; summary: string; expiresAt: string } | null;
  usage: { promptTokens: number; completionTokens: number; llmCalls: number };
}
