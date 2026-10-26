import { detectLanguage, languageName } from './language';

describe('detectLanguage', () => {
  it.each([
    ['Licht aus', 'de'],
    ['Mach das Licht im Wohnzimmer an', 'de'],
    ['Wie warm ist es in der Küche?', 'de'],
    ['ja', 'de'],
    ['Nein, lieber nicht', 'de'],
    ['Turn off the kitchen light', 'en'],
    ['What is the weather like tomorrow?', 'en'],
    ['yes please', 'en'],
    ['Kitchen light off', 'en'],
  ])('%s → %s', (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });

  it.each(['OK', 'Netflix', 'Spotify Daily Mix 3', ''])(
    'returns null without a clear signal: %s',
    (text) => {
      expect(detectLanguage(text)).toBeNull();
    },
  );

  it('only considers the given candidates', () => {
    expect(detectLanguage('Licht aus', ['en'])).toBeNull();
    expect(detectLanguage('Licht aus', ['de-AT', 'en'])).toBe('de');
  });
});

describe('languageName', () => {
  it('maps codes to English names', () => {
    expect(languageName('de')).toBe('German');
    expect(languageName('en')).toBe('English');
  });
});
