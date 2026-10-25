import { classifyReply, phrases } from './phrases';

describe('classifyReply', () => {
  it.each([
    ['Yes', 'en', 'yes'],
    ['yes please!', 'en', 'yes'],
    ['Aura, ja bitte', 'de', 'yes'],
    ['Mach es', 'de', 'yes'],
    ['No', 'en', 'no'],
    ['Nein, lieber nicht', 'de', 'no'],
    ['cancel that', 'de', 'no'],
    ['yes and also turn on all the lights in the house', 'en', 'other'],
    ['what is the weather', 'en', 'other'],
  ])('%s (%s) → %s', (text, language, expected) => {
    expect(classifyReply(text, language, 'Aura')).toBe(expected);
  });

  it('falls back to English phrases for unknown languages', () => {
    expect(phrases('fr').done).toBe('Done.');
    expect(phrases('de-AT').done).toBe('Erledigt.');
  });
});
