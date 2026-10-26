/**
 * The few sentences AURA says itself (without the LLM): confirmations are handled
 * deterministically so the model can never "confirm" an action on the user's behalf.
 */
interface PhraseSet {
  yes: string[];
  no: string[];
  confirm: (summary: string) => string;
  done: string;
  cancelled: string;
  failed: string;
  nothingPending: string;
  fallback: string;
  notPermitted: string;
  switchedOne: (name: string, action: 'on' | 'off') => string;
  switchedMany: (count: number, action: 'on' | 'off') => string;
}

const PHRASES: Record<string, PhraseSet> = {
  en: {
    yes: [
      'yes',
      'yeah',
      'yep',
      'sure',
      'ok',
      'okay',
      'confirm',
      'confirmed',
      'do it',
      'go ahead',
      'please do',
    ],
    no: ['no', 'nope', 'cancel', 'stop', 'abort', "don't", 'do not', 'never mind'],
    confirm: (summary) => `Just to be sure: should I ${summary}? Please say yes or no.`,
    done: 'Done.',
    cancelled: 'Okay, I cancelled that.',
    failed: 'Sorry, that did not work.',
    nothingPending: 'There is nothing waiting for confirmation.',
    fallback: 'Sorry, I could not come up with an answer.',
    notPermitted: "Sorry, you're not allowed to do that.",
    switchedOne: (name, action) => `${name} is now ${action}.`,
    switchedMany: (count, action) => `Done, ${count} lights are now ${action}.`,
  },
  de: {
    yes: [
      'ja',
      'jawohl',
      'klar',
      'ok',
      'okay',
      'bestätigt',
      'bestätige',
      'mach',
      'mach es',
      'mach das',
      'los',
      'gerne',
    ],
    no: ['nein', 'abbrechen', 'stopp', 'stop', 'lieber nicht', 'nicht', 'vergiss es'],
    confirm: (summary) =>
      `Nur zur Sicherheit: Soll ich ${summary} ausführen? Bitte sag ja oder nein.`,
    done: 'Erledigt.',
    cancelled: 'Okay, abgebrochen.',
    failed: 'Das hat leider nicht geklappt.',
    nothingPending: 'Es wartet nichts auf eine Bestätigung.',
    fallback: 'Darauf habe ich leider keine Antwort gefunden.',
    notPermitted: 'Das darfst du leider nicht.',
    switchedOne: (name, action) => `${name} ist jetzt ${action === 'on' ? 'an' : 'aus'}.`,
    switchedMany: (count, action) =>
      `Erledigt, ${count} Lichter sind jetzt ${action === 'on' ? 'an' : 'aus'}.`,
  },
};

export function phrases(language: string): PhraseSet {
  return PHRASES[language.toLowerCase().split('-')[0]] ?? PHRASES.en;
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export type ConfirmationReply = 'yes' | 'no' | 'other';

/**
 * Classifies a reply to a confirmation question. Only short, unambiguous replies count as "yes";
 * anything else is treated as "no" or as a new request.
 */
export function classifyReply(
  text: string,
  language: string,
  assistantName: string,
): ConfirmationReply {
  let normalized = normalize(text);
  const name = normalize(assistantName);
  if (name && normalized.startsWith(`${name} `)) normalized = normalized.slice(name.length + 1);
  const words = normalized.split(' ');
  const set = phrases(language);
  const startsWith = (list: string[]) =>
    list.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `));

  // Accept yes/no in every supported language: people answer in whatever language comes naturally.
  const all = Object.values(PHRASES);
  if (startsWith(set.no) || all.some((p) => startsWith(p.no))) return 'no';
  if (words.length <= 4 && (startsWith(set.yes) || all.some((p) => startsWith(p.yes))))
    return 'yes';
  return 'other';
}
