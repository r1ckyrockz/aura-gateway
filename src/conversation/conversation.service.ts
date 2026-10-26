import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AURA_CONFIG } from '../config/config.module';
import type { AuraConfig } from '../config/aura-config.schema';
import { errorMessage } from '../common/errors';
import { EntityDirectory } from '../home-assistant/entity-directory.service';
import { HomeAssistantClient } from '../home-assistant/ha.client';
import { LlmClient, type ChatMessage } from '../llm/llm.types';
import { PolicyService } from '../policy/policy.service';
import type { Principal } from '../policy/policy.types';
import { ToolRegistry } from '../tools/tool-registry.service';
import type { ToolContext } from '../tools/tool.types';
import { EventBus } from '../events/event-bus.service';
import { MetricsService } from '../metrics/metrics.service';
import { ConversationStore, type ConversationState } from './conversation.store';
import type { ActionRecord, ConverseInput, ConverseResult } from './conversation.types';
import { FastPathService } from './fast-path.service';
import { detectLanguage } from './language';
import { classifyReply, phrases } from './phrases';
import { buildSystemPrompt } from './system-prompt';

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const isError = (data: unknown) => typeof data === 'object' && data !== null && 'error' in data;

/**
 * The heart of the gateway: resolves who is asking, handles pending confirmations,
 * runs the LLM ⇄ tool loop and returns a short, speakable answer.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Inject(AURA_CONFIG) private readonly config: AuraConfig,
    private readonly llm: LlmClient,
    private readonly tools: ToolRegistry,
    private readonly policy: PolicyService,
    private readonly store: ConversationStore,
    private readonly ha: HomeAssistantClient,
    private readonly directory: EntityDirectory,
    private readonly fastPath: FastPathService,
    private readonly events: EventBus,
    private readonly metrics: MetricsService,
  ) {}

  async converse(input: ConverseInput): Promise<ConverseResult> {
    const conversationId = input.conversationId ?? randomUUID();
    const principal = this.policy.resolve(input);
    const meta = { conversationId, room: principal.room, speaker: principal.speaker };
    const started = Date.now();
    this.events.emit({
      ...meta,
      type: 'conversation.started',
      data: { profile: principal.profileName },
    });

    const result = await this.handle(input, conversationId, principal);

    const durationMs = Date.now() - started;
    this.metrics.conversations.inc({ route: result.route, profile: principal.profileName });
    this.metrics.conversationDuration.observe({ route: result.route }, durationMs / 1000);
    for (const action of result.actions) {
      this.metrics.toolCalls.inc({ tool: action.tool, status: action.status });
      this.events.emit({
        ...meta,
        type: 'tool.executed',
        data: { tool: action.tool, status: action.status },
      });
    }
    if (result.pendingConfirmation) {
      this.events.emit({
        ...meta,
        type: 'confirmation.requested',
        data: { ...result.pendingConfirmation },
      });
    }
    this.events.emit({
      ...meta,
      type: 'conversation.answered',
      data: { text: result.text, route: result.route, language: result.language, durationMs },
    });
    return result;
  }

  private async handle(
    input: ConverseInput,
    conversationId: string,
    principal: Principal,
  ): Promise<ConverseResult> {
    const state = this.store.get(conversationId);
    const { language, certain: languageCertain } = this.resolveLanguage(input, state);
    const say = phrases(language);
    const base = { conversationId, principal: describe(principal) };

    // 1. A pending action is waiting: only an explicit "yes" runs it.
    if (state.pending) {
      const reply = classifyReply(input.text, language, this.config.assistant.name);
      if (reply === 'yes') {
        const outcome = await this.runPending(state, language);
        this.emitResolved(conversationId, principal, 'approved');
        return { ...base, ...outcome };
      }
      const summary = state.pending.summary;
      this.store.clearPending(state);
      this.emitResolved(conversationId, principal, reply === 'no' ? 'rejected' : 'dropped');
      if (reply === 'no') {
        this.store.append(
          state,
          { role: 'user', content: input.text },
          { role: 'assistant', content: say.cancelled },
        );
        return {
          ...base,
          ...empty(say.cancelled, language),
          actions: [
            { tool: 'confirmation', arguments: { summary }, status: 'ok', result: 'cancelled' },
          ],
        };
      }
      // Anything else: the pending action is dropped and the text is handled as a new request.
    }

    // 2. Fast path for unambiguous on/off commands — no LLM needed.
    const fast = await this.fastPath.tryHandle(input.text, principal, language);
    if (fast) {
      this.store.append(
        state,
        { role: 'user', content: input.text },
        { role: 'assistant', content: fast.text },
      );
      return { ...base, ...empty(fast.text, language), route: 'fast_path', actions: fast.actions };
    }

    // 3. LLM ⇄ tools loop.
    const context: ToolContext = {
      principal,
      conversationId,
      language,
      timezone: this.config.assistant.timezone,
    };
    const history = input.history ?? state.history;
    const messages: ChatMessage[] = [
      { role: 'system', content: await this.systemPrompt(principal, language, languageCertain) },
      ...history,
      { role: 'user', content: input.text },
    ];
    const definitions = this.tools.definitions();
    const actions: ActionRecord[] = [];
    const usage = { promptTokens: 0, completionTokens: 0, llmCalls: 0 };
    let text: string | null = null;
    let pendingConfirmation: ConverseResult['pendingConfirmation'] = null;

    for (let i = 0; i < this.config.assistant.maxToolIterations && text === null; i++) {
      const response = await this.metrics.time(this.metrics.llmDuration, () =>
        this.llm.chat({ messages, tools: definitions }),
      );
      this.metrics.llmTokens.inc({ kind: 'prompt' }, response.usage?.prompt_tokens ?? 0);
      this.metrics.llmTokens.inc({ kind: 'completion' }, response.usage?.completion_tokens ?? 0);
      usage.llmCalls++;
      usage.promptTokens += response.usage?.prompt_tokens ?? 0;
      usage.completionTokens += response.usage?.completion_tokens ?? 0;

      const calls = response.message.tool_calls ?? [];
      if (calls.length === 0) {
        text = stripThinking(response.message.content ?? '').trim() || say.fallback;
        break;
      }
      messages.push({
        role: 'assistant',
        content: response.message.content ?? null,
        tool_calls: calls,
      });

      for (const call of calls) {
        const outcome = await this.tools.run(call.function.name, call.function.arguments, context);
        const args = safeJson(call.function.arguments);
        if (outcome.kind === 'confirmation_required') {
          const expiresAt = this.store.setPending(state, outcome.action);
          pendingConfirmation = {
            id: outcome.action.id,
            summary: outcome.action.summary,
            expiresAt: new Date(expiresAt).toISOString(),
          };
          actions.push({
            tool: call.function.name,
            arguments: args,
            status: 'pending_confirmation',
          });
          text = say.confirm(outcome.action.summary);
          break;
        }
        actions.push({
          tool: call.function.name,
          arguments: args,
          status: isError(outcome.data) ? 'error' : 'ok',
          result: outcome.data,
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(outcome.data),
        });
      }
    }

    const finalText = text ?? say.fallback;
    this.store.append(
      state,
      { role: 'user', content: input.text },
      { role: 'assistant', content: finalText },
    );
    return {
      ...base,
      text: finalText,
      route: 'llm',
      language,
      actions,
      pendingConfirmation,
      usage,
    };
  }

  /** Explicit confirmation via API (e.g. a button in the app or on a satellite display). */
  async resolvePending(conversationId: string, approve: boolean, language?: string) {
    const state = this.store.get(conversationId);
    const lang = language ?? state.language ?? this.config.assistant.language;
    const say = phrases(lang);
    if (!state.pending) return { conversationId, ...empty(say.nothingPending, lang) };
    const principal = this.policy.resolve({});
    if (!approve) {
      this.store.clearPending(state);
      this.emitResolved(conversationId, principal, 'rejected');
      return { conversationId, ...empty(say.cancelled, lang) };
    }
    const outcome = await this.runPending(state, lang);
    this.emitResolved(conversationId, principal, 'approved');
    return { conversationId, ...outcome };
  }

  private emitResolved(conversationId: string, principal: Principal, outcome: string) {
    this.events.emit({
      type: 'confirmation.resolved',
      conversationId,
      room: principal.room,
      speaker: principal.speaker,
      data: { outcome },
    });
  }

  private async runPending(state: ConversationState, language: string) {
    const pending = state.pending!;
    const say = phrases(language);
    this.store.clearPending(state);
    try {
      const data = await pending.run();
      this.store.append(state, { role: 'assistant', content: say.done });
      return {
        ...empty(say.done, language),
        actions: [
          {
            tool: pending.tool,
            arguments: { summary: pending.summary },
            status: 'ok' as const,
            result: data,
          },
        ],
      };
    } catch (error) {
      this.logger.warn(`Confirmed action failed: ${errorMessage(error)}`);
      return {
        ...empty(say.failed, language),
        actions: [
          {
            tool: pending.tool,
            arguments: { summary: pending.summary },
            status: 'error' as const,
            result: { error: errorMessage(error) },
          },
        ],
      };
    }
  }

  /**
   * Language for this turn: explicit request field → detected from the utterance →
   * previous language of the conversation → configured default.
   */
  private resolveLanguage(
    input: ConverseInput,
    state: ConversationState,
  ): { language: string; certain: boolean } {
    const { language: fallback, detectLanguage: detect, languages } = this.config.assistant;
    let result: { language: string; certain: boolean };
    if (input.language) {
      result = { language: input.language, certain: true };
    } else {
      const detected = detect ? detectLanguage(input.text, languages) : null;
      result = detected
        ? { language: detected, certain: true }
        : { language: detect ? (state.language ?? fallback) : fallback, certain: !detect };
    }
    state.language = result.language;
    return result;
  }

  private async systemPrompt(
    principal: Principal,
    language: string,
    languageCertain: boolean,
  ): Promise<string> {
    const { injectEntities, injectEntitiesLimit } = this.config.homeAssistant;
    let entities;
    if (this.ha.enabled && injectEntities && injectEntitiesLimit > 0) {
      try {
        const visible = (await this.directory.list()).filter((e) =>
          this.policy.canRead(principal, e),
        );
        if (visible.length <= injectEntitiesLimit) entities = visible;
      } catch (error) {
        this.logger.warn(`Could not load entities for prompt: ${errorMessage(error)}`);
      }
    }
    return buildSystemPrompt({
      config: this.config,
      principal,
      now: new Date(),
      entities,
      homeAssistantEnabled: this.ha.enabled,
      language,
      languageCertain,
    });
  }
}

function describe(principal: Principal): ConverseResult['principal'] {
  return {
    profile: principal.profileName,
    resolvedBy: principal.resolvedBy,
    speaker: principal.speaker,
    room: principal.room,
  };
}

function empty(
  text: string,
  language: string,
): Omit<ConverseResult, 'conversationId' | 'principal'> {
  return {
    text,
    language,
    route: 'confirmation',
    actions: [],
    pendingConfirmation: null,
    usage: { promptTokens: 0, completionTokens: 0, llmCalls: 0 },
  };
}

/** Removes `<think>…</think>` blocks emitted by reasoning models (Qwen3, DeepSeek-R1, …). */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '');
}
