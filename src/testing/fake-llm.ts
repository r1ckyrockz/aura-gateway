import { LlmClient, type ChatRequest, type ChatResult, type ToolCall } from '../llm/llm.types';

type Step = string | { tool: string; args: Record<string, unknown> }[];

/** Scripted LLM: each call consumes the next step (text answer or tool calls). */
export class FakeLlm extends LlmClient {
  readonly model = 'fake';
  readonly requests: ChatRequest[] = [];
  private counter = 0;

  constructor(private readonly steps: Step[]) {
    super();
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (step === undefined) throw new Error('FakeLlm: no more scripted steps');
    if (typeof step === 'string') {
      return { message: { role: 'assistant', content: step }, finishReason: 'stop' };
    }
    const tool_calls: ToolCall[] = step.map(({ tool, args }) => ({
      id: `call_${++this.counter}`,
      type: 'function',
      function: { name: tool, arguments: JSON.stringify(args) },
    }));
    return {
      message: { role: 'assistant', content: null, tool_calls },
      finishReason: 'tool_calls',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }

  async ping(): Promise<void> {}
}
