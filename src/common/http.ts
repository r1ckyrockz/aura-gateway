import { UpstreamError } from './errors';

export interface JsonRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

/** Small fetch wrapper with timeout, JSON handling and typed upstream errors. */
export async function requestJson<T>(
  upstream: UpstreamError['upstream'],
  url: string,
  { method = 'GET', headers = {}, body, timeoutMs }: JsonRequest,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpstreamError(upstream, `Request to ${upstream} failed: ${reason}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new UpstreamError(
      upstream,
      `${upstream} responded with ${response.status}: ${text.slice(0, 300)}`,
      response.status,
    );
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}
