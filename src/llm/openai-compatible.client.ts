import { Inject, Injectable } from '@nestjs/common';
import { AURA_ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { UpstreamError } from '../common/errors';
import { requestJson } from '../common/http';
import { LlmClient, type ChatRequest, type ChatResult } from './llm.types';

interface CompletionResponse {
  choices?: { message: ChatResult['message']; finish_reason: string | null }[];
  usage?: ChatResult['usage'];
}

/**
 * Talks to any OpenAI-compatible inference server: Ollama, vLLM, llama.cpp server,
 * LM Studio, LocalAI, TGI — or a hosted API if you really want to.
 */
@Injectable()
export class OpenAiCompatibleClient extends LlmClient {
  readonly model: string;
  private readonly baseUrl: string;

  constructor(@Inject(AURA_ENV) private readonly env: Env) {
    super();
    this.model = env.LLM_MODEL;
    this.baseUrl = env.LLM_BASE_URL.replace(/\/+$/, '');
  }

  async chat({ messages, tools }: ChatRequest): Promise<ChatResult> {
    const data = await requestJson<CompletionResponse>('llm', `${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      timeoutMs: this.env.LLM_TIMEOUT_MS,
      body: {
        model: this.model,
        messages,
        temperature: this.env.LLM_TEMPERATURE,
        stream: false,
        ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      },
    });
    const choice = data?.choices?.[0];
    if (!choice) throw new UpstreamError('llm', 'LLM returned no choices');
    return {
      message: {
        role: 'assistant',
        content: choice.message.content ?? null,
        tool_calls: choice.message.tool_calls,
      },
      finishReason: choice.finish_reason,
      usage: data.usage,
    };
  }

  async ping(): Promise<void> {
    await requestJson('llm', `${this.baseUrl}/models`, {
      headers: this.headers(),
      timeoutMs: Math.min(this.env.LLM_TIMEOUT_MS, 5_000),
    });
  }

  private headers(): Record<string, string> {
    return this.env.LLM_API_KEY ? { authorization: `Bearer ${this.env.LLM_API_KEY}` } : {};
  }
}
