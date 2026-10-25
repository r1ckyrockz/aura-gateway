import { z } from 'zod';
import type { Principal } from '../policy/policy.types';
import { ToolRegistry } from './tool-registry.service';
import { result, type AuraTool, type ToolContext } from './tool.types';

const echo: AuraTool = {
  name: 'echo',
  description: 'Echo a word',
  schema: z.object({ word: z.string().describe('The word') }),
  isAvailable: () => true,
  execute: async (args) => result(args),
};
const boom: AuraTool = {
  name: 'boom',
  description: 'Always fails',
  schema: z.object({}),
  isAvailable: () => true,
  execute: async () => {
    throw new Error('kaputt');
  },
};
const hidden: AuraTool = { ...echo, name: 'hidden', isAvailable: () => false };
const ctx: ToolContext = {
  principal: {} as Principal,
  conversationId: 'x',
  language: 'en',
  timezone: 'UTC',
};

describe('ToolRegistry', () => {
  const registry = new ToolRegistry([echo, boom, hidden]);

  it('renders JSON schema definitions for available tools only', () => {
    const defs = registry.definitions();
    expect(defs.map((d) => d.function.name)).toEqual(['echo', 'boom']);
    expect(defs[0].function.parameters).toMatchObject({
      type: 'object',
      properties: { word: { type: 'string', description: 'The word' } },
      required: ['word'],
    });
    expect(defs[0].function.parameters).not.toHaveProperty('$schema');
  });

  it('validates arguments and never throws', async () => {
    expect(await registry.run('echo', '{"word":"hi"}', ctx)).toEqual(result({ word: 'hi' }));
    expect(await registry.run('echo', '{', ctx)).toEqual(
      result({ error: 'Arguments must be valid JSON' }),
    );
    expect(await registry.run('echo', '{"word":1}', ctx)).toMatchObject({
      data: { error: 'Invalid arguments' },
    });
    expect(await registry.run('boom', '', ctx)).toEqual(result({ error: 'kaputt' }));
    expect(await registry.run('hidden', '{}', ctx)).toEqual(
      result({ error: 'Unknown tool: hidden' }),
    );
  });

  it('rejects duplicate names', () => {
    expect(() => new ToolRegistry([echo, echo])).toThrow(/Duplicate/);
  });
});
