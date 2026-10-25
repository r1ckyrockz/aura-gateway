import { parseAuraConfig, parseEnv } from '../config/load-config';
import type { AuraConfig } from '../config/aura-config.schema';
import type { AuraEntity } from '../home-assistant/ha.types';

export const testConfig = (overrides: Record<string, unknown> = {}): AuraConfig =>
  parseAuraConfig({
    assistant: { name: 'Aura', language: 'en', timezone: 'Europe/Berlin' },
    policy: {
      defaultProfile: 'guest',
      confirmDomains: ['lock'],
      profiles: {
        adult: { allowDomains: ['*'] },
        child: {
          allowDomains: ['light', 'media_player'],
          areas: ['$room'],
          denyEntities: ['media_player.tv'],
        },
        guest: { allowDomains: ['light'] },
        viewer: { allowDomains: ['*'], readOnly: true },
      },
      speakers: { alex: 'adult' },
      rooms: { 'Kids Room': 'child' },
      clients: { abc123: 'viewer' },
    },
    ...overrides,
  });

export const testEnv = (overrides: Record<string, string> = {}) =>
  parseEnv({
    LLM_BASE_URL: 'http://llm.test/v1',
    HA_URL: 'http://ha.test',
    HA_TOKEN: 't',
    ...overrides,
  });

export const entity = (
  entityId: string,
  area: string | null = null,
  state = 'off',
): AuraEntity => ({
  entityId,
  domain: entityId.split('.')[0],
  name: entityId.split('.')[1].replace(/_/g, ' '),
  state,
  area,
  attributes: {},
});
