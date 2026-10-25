/** Error raised by an upstream dependency (LLM server, Home Assistant). */
export class UpstreamError extends Error {
  constructor(
    readonly upstream: 'llm' | 'home-assistant',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
