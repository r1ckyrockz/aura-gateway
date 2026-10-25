/**
 * Parser for simple on/off commands ("turn off the kitchen light", "Licht im Bad an").
 * Pure functions — resolution and execution live in FastPathService.
 */
export interface FastCommand {
  action: 'on' | 'off';
  target: string;
  room?: string;
}

const ACTIONS: Record<string, 'on' | 'off'> = {
  on: 'on',
  off: 'off',
  an: 'on',
  ein: 'on',
  aus: 'off',
  ab: 'off',
};

export const GENERIC_LIGHT_WORDS = new Set([
  'light',
  'lights',
  'lamp',
  'lamps',
  'licht',
  'lichter',
  'lampe',
  'lampen',
  'beleuchtung',
]);

const PATTERNS: RegExp[] = [
  // English
  /^(?:can you |could you )?(?:turn|switch) (on|off) (?:all the |all |the )?(.+)$/,
  /^(?:can you |could you )?(?:turn|switch) (?:all the |all |the )?(.+?) (on|off)$/,
  // German
  /^(?:schalte|schalt|mach|mache)(?: mal| bitte)? (?:alle |das |die |den )?(.+?) (an|aus|ein|ab)$/,
  // Short forms, both languages: "kitchen light off", "Licht aus"
  /^(?:the |das |die |den )?(.+?) (on|off|an|aus)$/,
];

const ROOM_SPLIT = /^(.+?) (?:in the|in der|in dem|im|in|on the) (.+)$/;
const FILLERS = /^(?:please|bitte|hey|ok|okay) |(?: please| bitte| mal)$/g;

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseFastCommand(text: string, assistantName: string): FastCommand | null {
  let normalized = normalizeText(text);
  const name = normalizeText(assistantName);
  if (name && (normalized === name || normalized.startsWith(`${name} `))) {
    normalized = normalized.slice(name.length).trim();
  }
  // Strip polite fillers at both ends (repeat: "please turn off the light please").
  for (let i = 0; i < 3; i++) normalized = normalized.replace(FILLERS, '').trim();

  for (const [index, pattern] of PATTERNS.entries()) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const [first, second] = [match[1], match[2]];
    const actionFirst = index === 0;
    const action = ACTIONS[actionFirst ? first : second];
    let target = (actionFirst ? second : first).trim();
    if (!action || !target) continue;
    // Short forms are only safe for short targets.
    if (index === PATTERNS.length - 1 && target.split(' ').length > 4) return null;

    let room: string | undefined;
    const split = ROOM_SPLIT.exec(target);
    if (split) {
      target = split[1].trim();
      room = split[2].replace(/^(?:the|der|dem|die|das) /, '').trim();
    }
    return { action, target, room };
  }
  return null;
}
