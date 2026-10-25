import type { AuraConfig } from '../config/aura-config.schema';
import type { AuraEntity } from '../home-assistant/ha.types';
import type { Principal } from '../policy/policy.types';

export interface PromptInput {
  config: AuraConfig;
  principal: Principal;
  now: Date;
  entities?: AuraEntity[];
  homeAssistantEnabled: boolean;
}

/** Builds the system prompt. Kept short on purpose: small local models follow short prompts better. */
export function buildSystemPrompt({
  config,
  principal,
  now,
  entities,
  homeAssistantEnabled,
}: PromptInput): string {
  const { name, language, persona, timezone } = config.assistant;
  const localTime = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(now);

  const lines = [
    `You are ${name}, a private voice assistant running locally in a family home.`,
    `Always answer in the language with code "${language}" unless the user clearly speaks another language.`,
    'Your answers are usually spoken aloud: be brief (one or two sentences), no markdown, no lists, no emojis.',
    `Current local time: ${localTime} (${timezone}).`,
    `The current user has the profile "${principal.profileName}"${principal.speaker ? ` (speaker: ${principal.speaker})` : ''}.`,
  ];
  if (principal.room) {
    lines.push(
      `The request comes from the area "${principal.room}". If the user does not name a room, assume this one.`,
    );
  }
  if (homeAssistantEnabled) {
    lines.push(
      'You can see and control the smart home only through the provided tools. Never claim to have done something unless a tool call succeeded.',
      'If a tool returns "not_permitted", tell the user politely that they are not allowed to do that.',
      'Do not ask for confirmation yourself — the system asks the user when an action needs it.',
    );
  } else {
    lines.push('No smart-home connection is configured. If asked to control devices, say so.');
  }
  if (entities && entities.length > 0) {
    lines.push(
      'Known devices (entity_id | name | area | state):',
      ...entities.map((e) => `${e.entityId} | ${e.name} | ${e.area ?? '-'} | ${e.state}`),
    );
  }
  if (persona.trim()) lines.push(persona.trim());
  return lines.join('\n');
}
