import { buildAreaMap, fetchAreaMap, websocketUrl, type WebSocketFactory } from './ha-registry';

const areas = [
  { area_id: 'kuche', name: 'Küche' },
  { area_id: 'bad', name: 'Bad' },
];
const devices = [{ id: 'dev1', area_id: 'bad' }];
const entities = [
  { entity_id: 'switch.kuche_licht', area_id: 'kuche', device_id: null },
  { entity_id: 'switch.bad_licht_1', area_id: null, device_id: 'dev1' },
  { entity_id: 'sensor.orphan', area_id: null, device_id: null },
];

/** Fake Home Assistant WebSocket server speaking the auth + command protocol. */
function fakeHa(token: string, failCommand?: string): WebSocketFactory {
  return () => {
    const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
    const emit = (message: unknown) =>
      setTimeout(() => listeners.message?.forEach((l) => l({ data: JSON.stringify(message) })));
    const socket = {
      addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
        (listeners[type] ??= []).push(listener);
      },
      close: () => undefined,
      send: (raw: string) => {
        const message = JSON.parse(raw) as { type: string; id?: number; access_token?: string };
        if (message.type === 'auth') {
          emit({ type: message.access_token === token ? 'auth_ok' : 'auth_invalid' });
          return;
        }
        const result = {
          'config/area_registry/list': areas,
          'config/device_registry/list': devices,
          'config/entity_registry/list': entities,
        }[message.type];
        emit(
          message.type === failCommand
            ? { id: message.id, type: 'result', success: false, error: { message: 'Unauthorized' } }
            : { id: message.id, type: 'result', success: true, result },
        );
      },
    };
    emit({ type: 'auth_required' });
    return socket;
  };
}

describe('Home Assistant registry', () => {
  it('builds the WebSocket URL', () => {
    expect(websocketUrl('http://ha.local:8123/')).toBe('ws://ha.local:8123/api/websocket');
    expect(websocketUrl('https://ha.example.org')).toBe('wss://ha.example.org/api/websocket');
  });

  it('resolves areas directly and via the device', () => {
    const map = buildAreaMap(areas, devices, entities);
    expect(map.get('switch.kuche_licht')).toBe('Küche');
    expect(map.get('switch.bad_licht_1')).toBe('Bad');
    expect(map.get('sensor.orphan')).toBeNull();
  });

  it('authenticates and runs the three list commands', async () => {
    const map = await fetchAreaMap('http://ha', 'secret', 1000, fakeHa('secret'));
    expect(map.get('switch.bad_licht_1')).toBe('Bad');
  });

  it('rejects invalid tokens and failed commands', async () => {
    await expect(fetchAreaMap('http://ha', 'wrong', 1000, fakeHa('secret'))).rejects.toThrow(
      /rejected the token/,
    );
    await expect(
      fetchAreaMap('http://ha', 'secret', 1000, fakeHa('secret', 'config/device_registry/list')),
    ).rejects.toThrow(/Unauthorized/);
  });
});
