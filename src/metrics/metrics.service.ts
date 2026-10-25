import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/** Prometheus metrics. Each Gateway instance has its own registry (keeps tests isolated). */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly conversations = new Counter({
    name: 'aura_conversations_total',
    help: 'Handled utterances by route and profile',
    labelNames: ['route', 'profile'] as const,
    registers: [this.registry],
  });

  readonly conversationDuration = new Histogram({
    name: 'aura_conversation_duration_seconds',
    help: 'Time from utterance to answer',
    labelNames: ['route'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32],
    registers: [this.registry],
  });

  readonly llmDuration = new Histogram({
    name: 'aura_llm_request_duration_seconds',
    help: 'Duration of single LLM chat requests',
    labelNames: ['outcome'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64],
    registers: [this.registry],
  });

  readonly llmTokens = new Counter({
    name: 'aura_llm_tokens_total',
    help: 'Tokens reported by the LLM server',
    labelNames: ['kind'] as const,
    registers: [this.registry],
  });

  readonly toolCalls = new Counter({
    name: 'aura_tool_calls_total',
    help: 'Tool executions by tool and status',
    labelNames: ['tool', 'status'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'aura_' });
  }

  /** Times an async call and records it in the given histogram. */
  async time<T>(histogram: Histogram<'outcome'>, fn: () => Promise<T>): Promise<T> {
    const end = histogram.startTimer();
    try {
      const value = await fn();
      end({ outcome: 'ok' });
      return value;
    } catch (error) {
      end({ outcome: 'error' });
      throw error;
    }
  }
}
