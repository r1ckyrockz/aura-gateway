import { matchesAny, matchesPattern } from './patterns';

const door = { entityId: 'switch.haustuere_door_1_relay', name: 'Haustuere Door 1 relay' };
const heating = { entityId: 'switch.kuche_deckenheizung', name: 'Küche Deckenheizung' };

describe('patterns', () => {
  it('matches exact ids', () => {
    expect(matchesPattern('switch.haustuere_door_1_relay', door)).toBe(true);
    expect(matchesPattern('switch.haustuere', door)).toBe(false);
  });

  it('matches globs on the entity id', () => {
    expect(matchesPattern('switch.*_relay', door)).toBe(true);
    expect(matchesPattern('switch.haustuere_door_?_relay', door)).toBe(true);
    expect(matchesPattern('light.*', door)).toBe(false);
  });

  it('matches name: globs case-insensitively, including umlauts', () => {
    expect(matchesPattern('name:*deckenheizung', heating)).toBe(true);
    expect(matchesPattern('name:KÜCHE*', heating)).toBe(true);
    expect(matchesPattern('name:Haustuere*', heating)).toBe(false);
  });

  it('treats regex characters literally', () => {
    const odd = { entityId: 'light.a', name: 'Lampe Balkon (Außen) 1' };
    expect(matchesPattern('name:Lampe Balkon (Außen) ?', odd)).toBe(true);
    expect(matchesAny(['name:*(Innen)*', 'light.b'], odd)).toBe(false);
  });
});
