import { entity } from '../testing/fixtures';
import { parseFastCommand, type FastCommand } from './fast-path';
import { resolveTargets } from './fast-path.service';

describe('parseFastCommand', () => {
  it.each<[string, FastCommand | null]>([
    ['Turn off the kitchen light', { action: 'off', target: 'kitchen light' }],
    [
      'Aura, please switch on the lights in the living room',
      { action: 'on', target: 'lights', room: 'living room' },
    ],
    ['turn the desk lamp on please', { action: 'on', target: 'desk lamp' }],
    ['Licht aus', { action: 'off', target: 'licht' }],
    ['Mach das Licht im Wohnzimmer an', { action: 'on', target: 'licht', room: 'wohnzimmer' }],
    ['Schalte bitte die Stehlampe ein', { action: 'on', target: 'stehlampe' }],
    ['schalte das licht in der küche aus', { action: 'off', target: 'licht', room: 'küche' }],
    ['Kitchen light off!', { action: 'off', target: 'kitchen light' }],
    ['What is the weather like?', null],
    ['Could you tell me whether the oven in the kitchen is still on', null],
  ])('%s', (text, expected) => {
    expect(parseFastCommand(text, 'Aura')).toEqual(
      expected === null ? null : { room: undefined, ...expected },
    );
  });
});

describe('resolveTargets', () => {
  const entities = [
    entity('light.kitchen_ceiling', 'Kitchen'),
    entity('light.kitchen_counter', 'Kitchen'),
    entity('light.desk_lamp', 'Office'),
    entity('switch.coffee_machine', 'Kitchen'),
    entity('light.ceiling', 'Office'),
    entity('light.ceiling', 'Bedroom'),
  ];
  // entity() derives the name from the object id, e.g. "kitchen ceiling"
  const cmd = (target: string, room?: string): FastCommand => ({ action: 'on', target, room });

  it('resolves generic light words to all lights in the room', () => {
    expect(
      resolveTargets(cmd('lights', 'kitchen'), entities, undefined)?.map((e) => e.entityId),
    ).toEqual(['light.kitchen_ceiling', 'light.kitchen_counter']);
    expect(resolveTargets(cmd('licht'), entities, 'Office')?.length).toBe(2);
    expect(resolveTargets(cmd('kitchen lights'), entities, undefined)?.length).toBe(2);
  });

  it('needs a room for generic words', () => {
    expect(resolveTargets(cmd('lights'), entities, undefined)).toBeNull();
  });

  it('matches device names exactly, disambiguating by the request room', () => {
    expect(resolveTargets(cmd('desk lamp'), entities, undefined)?.[0].entityId).toBe(
      'light.desk_lamp',
    );
    expect(resolveTargets(cmd('ceiling'), entities, undefined)).toBeNull();
    expect(resolveTargets(cmd('ceiling'), entities, 'Bedroom')?.[0].area).toBe('Bedroom');
  });

  it('allows partial names only within a room', () => {
    expect(resolveTargets(cmd('coffee'), entities, 'Kitchen')?.[0].entityId).toBe(
      'switch.coffee_machine',
    );
    expect(resolveTargets(cmd('coffee'), entities, undefined)).toBeNull();
  });
});
