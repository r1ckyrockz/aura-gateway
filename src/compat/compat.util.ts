import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { ChatMessage } from '../llm/llm.types';

export const AURA_MODEL = 'aura';

export interface IncomingMessage {
  role: string;
  content?: unknown;
}

/** Extracts plain text from OpenAI-style content (string or array of parts). */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) =>
        typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
          ? part.text
          : '',
      )
      .join('');
  }
  return '';
}

/**
 * Splits a client transcript into AURA history + the latest user utterance.
 * Client system prompts and tool messages are ignored: AURA brings its own prompt, tools and policy.
 */
export function splitTranscript(messages: IncomingMessage[]): {
  history: ChatMessage[];
  text: string;
} {
  const turns = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: contentText(m.content).trim() }))
    .filter((m) => m.content.length > 0);
  const lastUser = turns.map((t) => t.role).lastIndexOf('user');
  if (lastUser === -1) return { history: [], text: '' };
  return { history: turns.slice(0, lastUser), text: turns[lastUser].content };
}

const header = (req: Request, name: string) => {
  const value = req.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/**
 * Conversation id for stateless clients. Explicit header/`user` field wins; otherwise the id is
 * derived from the client address + first user message, which stays stable for clients (like
 * Home Assistant) that resend the whole transcript on every turn.
 */
export function conversationIdFor(
  req: Request,
  messages: IncomingMessage[],
  user?: string,
): string {
  const explicit = header(req, 'x-aura-conversation-id') ?? user;
  if (explicit) return explicit;
  const first = messages.find((m) => m.role === 'user');
  const seed = `${req.ip ?? ''}|${contentText(first?.content)}`;
  return `h-${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
}

export const auraHeaders = (req: Request) => ({
  speaker: header(req, 'x-aura-speaker'),
  room: header(req, 'x-aura-room'),
});
