import type { Request } from 'express';
import { contentText, conversationIdFor, splitTranscript } from './compat.util';

const req = (headers: Record<string, string> = {}, ip = '10.0.0.5') =>
  ({ headers, ip }) as unknown as Request;

describe('compat utils', () => {
  it('extracts text from content parts', () => {
    expect(
      contentText([
        { type: 'text', text: 'Hello ' },
        { type: 'image_url' },
        { type: 'text', text: 'there' },
      ]),
    ).toBe('Hello there');
  });

  it('splits history and drops client system/tool messages', () => {
    const { history, text } = splitTranscript([
      { role: 'system', content: 'You are HA' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: '{}' },
      { role: 'user', content: 'turn on the light' },
    ]);
    expect(text).toBe('turn on the light');
    expect(history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('derives a stable conversation id from the first user turn', () => {
    const first = [{ role: 'user', content: 'unlock the door' }];
    const later = [
      ...first,
      { role: 'assistant', content: 'sure?' },
      { role: 'user', content: 'yes' },
    ];
    expect(conversationIdFor(req(), first)).toBe(conversationIdFor(req(), later));
    expect(conversationIdFor(req({}, '10.0.0.6'), first)).not.toBe(conversationIdFor(req(), first));
    expect(conversationIdFor(req({ 'x-aura-conversation-id': 'abc' }), first)).toBe('abc');
  });
});
