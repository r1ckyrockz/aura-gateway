import { Inject, Injectable } from '@nestjs/common';
import { AURA_CONFIG } from '../config/config.module';
import type { AuraConfig } from '../config/aura-config.schema';
import type { ChatMessage } from '../llm/llm.types';
import type { PendingAction } from '../tools/tool.types';

export interface ConversationState {
  id: string;
  /** Only user/assistant text turns — tool chatter is not persisted. */
  history: ChatMessage[];
  /** Language of the last utterance — used when the next one gives no clear signal ("OK"). */
  language?: string;
  pending?: PendingAction & { expiresAt: number };
  updatedAt: number;
}

/** In-memory, TTL-bound conversation store. Nothing is written to disk. */
@Injectable()
export class ConversationStore {
  private readonly conversations = new Map<string, ConversationState>();

  constructor(@Inject(AURA_CONFIG) private readonly config: AuraConfig) {}

  get(id: string): ConversationState {
    this.sweep();
    const existing = this.conversations.get(id);
    if (existing) {
      if (existing.pending && existing.pending.expiresAt < Date.now()) existing.pending = undefined;
      return existing;
    }
    const fresh: ConversationState = { id, history: [], updatedAt: Date.now() };
    this.conversations.set(id, fresh);
    return fresh;
  }

  append(state: ConversationState, ...messages: ChatMessage[]): void {
    state.history.push(...messages);
    const max = this.config.conversation.maxHistoryMessages;
    if (state.history.length > max) state.history.splice(0, state.history.length - max);
    state.updatedAt = Date.now();
  }

  setPending(state: ConversationState, action: PendingAction): number {
    const expiresAt = Date.now() + this.config.conversation.confirmationTtlSeconds * 1000;
    state.pending = { ...action, expiresAt };
    state.updatedAt = Date.now();
    return expiresAt;
  }

  clearPending(state: ConversationState): void {
    state.pending = undefined;
  }

  size(): number {
    return this.conversations.size;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.config.conversation.ttlSeconds * 1000;
    for (const [id, state] of this.conversations) {
      if (state.updatedAt < cutoff) this.conversations.delete(id);
    }
  }
}
