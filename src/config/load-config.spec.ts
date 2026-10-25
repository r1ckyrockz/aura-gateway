import { ConfigError, parseAuraConfig, parseEnv } from './load-config';

describe('config', () => {
  it('applies sensible defaults', () => {
    const config = parseAuraConfig(undefined);
    expect(config.assistant.name).toBe('Aura');
    expect(config.policy.defaultProfile).toBe('guest');
    expect(config.policy.profiles.owner.allowDomains).toEqual(['*']);
    expect(config.homeAssistant.exposure.domains).toContain('light');
  });

  it('rejects references to unknown profiles', () => {
    expect(() =>
      parseAuraConfig({
        policy: { profiles: { adult: {} }, defaultProfile: 'adult', rooms: { kitchen: 'chef' } },
      }),
    ).toThrow(/Unknown profile "chef"/);
  });

  it('parses env lists and booleans', () => {
    const env = parseEnv({ AURA_API_KEYS: 'a, b,,c', AURA_ENABLE_DOCS: 'false' });
    expect(env.AURA_API_KEYS).toEqual(['a', 'b', 'c']);
    expect(env.AURA_ENABLE_DOCS).toBe(false);
    expect(env.AURA_OLLAMA_COMPAT).toBe(true);
  });

  it('requires a token when Home Assistant is configured', () => {
    expect(() => parseEnv({ HA_URL: 'http://ha.local:8123' })).toThrow(ConfigError);
  });
});
