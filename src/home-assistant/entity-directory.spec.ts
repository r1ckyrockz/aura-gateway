import { testConfig } from '../testing/fixtures';
import { EntityDirectory } from './entity-directory.service';
import type { HomeAssistantClient } from './ha.client';

const states = [
  { entity_id: 'switch.kuche_licht', state: 'off', attributes: { friendly_name: 'Küche Licht' } },
  {
    entity_id: 'switch.kuche_deckenheizung',
    state: 'on',
    attributes: { friendly_name: 'Küche Deckenheizung' },
  },
  {
    entity_id: 'switch.haustuere_door_1_relay',
    state: 'off',
    attributes: { friendly_name: 'Haustuere Door 1 relay' },
  },
  {
    entity_id: 'sensor.kuche_temperature',
    state: '20',
    attributes: { friendly_name: 'Küche Temperatur' },
  },
  {
    entity_id: 'input_boolean.guest_mode',
    state: 'off',
    attributes: { friendly_name: 'Gästemodus' },
  },
];

describe('EntityDirectory exposure', () => {
  const ha = {
    getStates: async () => states,
    getAreas: async () => new Map([['switch.kuche_licht', 'Küche']]),
  } as unknown as HomeAssistantClient;

  it('applies domains, include and exclude patterns (exclude wins)', async () => {
    const config = testConfig({
      homeAssistant: {
        exposure: {
          domains: ['switch'],
          includeEntities: ['input_boolean.*', 'switch.haustuere_*'],
          excludeEntities: ['name:*Deckenheizung', 'switch.*_relay'],
        },
      },
    });
    const ids = (await new EntityDirectory(ha, config).list()).map((e) => e.entityId);
    expect(ids).toEqual(['switch.kuche_licht', 'input_boolean.guest_mode']);
  });

  it('resolves areas', async () => {
    const entity = await new EntityDirectory(ha, testConfig()).get('switch.kuche_licht');
    expect(entity).toMatchObject({ name: 'Küche Licht', area: 'Küche', domain: 'switch' });
  });
});
