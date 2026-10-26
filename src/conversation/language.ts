/**
 * Lightweight, dependency-free language detection for short household utterances.
 * It only has to tell apart the languages AURA has phrases for, and it is allowed to say
 * "don't know" — the caller then keeps the conversation's previous language or the default.
 */
const vocabulary = (words: string) => new Set(words.split(/\s+/));

const MARKERS: Record<string, { words: Set<string>; chars?: RegExp }> = {
  de: {
    chars: /[äöüß]/g,
    words: vocabulary(
      'der die das den dem des und oder ist sind nicht kein keine ich du wir mir mich mein ' +
        'meine bitte danke ja nein doch mach mache schalte schalt stell stelle aus ein eine einen ' +
        'im auf zu mal wie was wo wann warum wer welche welcher gibt es licht lichter lampe ' +
        'heizung rollladen rollläden wetter heute morgen spät uhr grad wohnzimmer küche bad ' +
        'schlafzimmer kinderzimmer lieber gerne klar erledigt abbrechen stopp noch schon jetzt ' +
        'hallo',
    ),
  },
  en: {
    words: vocabulary(
      'the and or is are not no yes i you we me my please thanks thank turn switch set off on a ' +
        'an to of in at what how where when why who which there it light lights lamp heating ' +
        'blinds weather today tomorrow time degrees living room kitchen bathroom bedroom sure ' +
        'yeah yep nope cancel stop do it can could would hello hi now still all',
    ),
  },
};

export const SUPPORTED_LANGUAGES = Object.keys(MARKERS);

/** Primary language subtag: "de-AT" → "de". */
export const baseLanguage = (language: string) => language.toLowerCase().split('-')[0];

/**
 * Returns the most likely language among `candidates`, or `null` if the text gives no clear signal
 * (e.g. "OK", "Netflix", a single name).
 */
export function detectLanguage(
  text: string,
  candidates: string[] = SUPPORTED_LANGUAGES,
): string | null {
  const lower = text.toLowerCase();
  const words = lower
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const scores = candidates
    .map(baseLanguage)
    .filter((lang) => MARKERS[lang])
    .map((lang) => {
      const { words: vocab, chars } = MARKERS[lang];
      let score = words.filter((w) => vocab.has(w)).length;
      if (chars) score += 2 * (lower.match(chars)?.length ?? 0);
      return { lang, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0 || scores[0].score === 0) return null;
  if (scores.length > 1 && scores[0].score === scores[1].score) return null;
  return scores[0].lang;
}

/** English name of a language code, for the system prompt ("de" → "German"). */
export function languageName(language: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}
