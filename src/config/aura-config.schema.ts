import { z } from 'zod';

/** Wildcard that matches every domain. */
export const ANY = '*';
/** Placeholder in `areas` that resolves to the room the request comes from. */
export const CURRENT_ROOM = '$room';

export const profileSchema = z.object({
  description: z.string().optional(),
  /** Domains this profile may act on, e.g. `light`, `cover`. `*` allows everything. */
  allowDomains: z.array(z.string()).default([]),
  /** Entities that are always off-limits for this profile. */
  denyEntities: z.array(z.string()).default([]),
  /** If set, actions are limited to entities in these areas. `$room` = the requesting room. */
  areas: z.array(z.string()).optional(),
  /** Read-only profiles may query states but never call services. */
  readOnly: z.boolean().default(false),
});

export const auraConfigSchema = z.object({
  assistant: z
    .object({
      name: z.string().default('Aura'),
      /** BCP-47 language used for replies and built-in phrases (`en`, `de`, ...). */
      language: z.string().default('en'),
      /**
       * Detect the language of each utterance and answer in it (falls back to the conversation's
       * previous language, then to `language`). Disable to always answer in `language`.
       */
      detectLanguage: z.boolean().default(true),
      /** Languages considered by detection. Built-in phrases exist for `en` and `de`. */
      languages: z.array(z.string()).min(1).default(['en', 'de']),
      /** Extra instructions appended to the system prompt. */
      persona: z.string().default(''),
      timezone: z.string().default(Intl.DateTimeFormat().resolvedOptions().timeZone),
      maxToolIterations: z.number().int().min(1).max(20).default(6),
    })
    .prefault({}),
  conversation: z
    .object({
      ttlSeconds: z.number().int().positive().default(300),
      maxHistoryMessages: z.number().int().min(0).max(100).default(12),
      confirmationTtlSeconds: z.number().int().positive().default(60),
    })
    .prefault({}),
  fastPath: z
    .object({
      /** Handle simple on/off commands without the LLM (English and German). */
      enabled: z.boolean().default(true),
      /** Domains the fast path may switch. */
      domains: z.array(z.string()).default(['light', 'switch', 'fan', 'input_boolean']),
    })
    .prefault({}),
  homeAssistant: z
    .object({
      exposure: z
        .object({
          domains: z
            .array(z.string())
            .default([
              'light',
              'switch',
              'cover',
              'climate',
              'fan',
              'media_player',
              'scene',
              'script',
              'sensor',
              'binary_sensor',
              'lock',
              'vacuum',
            ]),
          includeEntities: z.array(z.string()).default([]),
          excludeEntities: z.array(z.string()).default([]),
        })
        .prefault({}),
      /** Inject a compact entity list into the prompt (faster, fewer tool calls). */
      injectEntities: z.boolean().default(true),
      injectEntitiesLimit: z.number().int().min(0).max(1000).default(150),
      cacheSeconds: z.number().int().min(0).default(10),
    })
    .prefault({}),
  policy: z
    .object({
      defaultProfile: z.string().default('guest'),
      /** Domains whose actions need an explicit "yes" from the user before they run. */
      confirmDomains: z.array(z.string()).default(['lock', 'alarm_control_panel']),
      profiles: z.record(z.string(), profileSchema).default({
        owner: { allowDomains: [ANY], denyEntities: [], readOnly: false },
        guest: { allowDomains: ['light', 'media_player'], denyEntities: [], readOnly: false },
      }),
      /** Identified speakers (e.g. from voice profiles) → profile. */
      speakers: z.record(z.string(), z.string()).default({}),
      /** Unidentified requests from a room → profile. */
      rooms: z.record(z.string(), z.string()).default({}),
      /** API key fingerprint label → profile (lets an app key act as a given profile). */
      clients: z.record(z.string(), z.string()).default({}),
    })
    .prefault({})
    .superRefine((policy, ctx) => {
      const known = new Set(Object.keys(policy.profiles));
      const check = (profile: string, path: (string | number)[]) => {
        if (!known.has(profile)) {
          ctx.addIssue({ code: 'custom', message: `Unknown profile "${profile}"`, path });
        }
      };
      check(policy.defaultProfile, ['defaultProfile']);
      for (const [k, v] of Object.entries(policy.speakers)) check(v, ['speakers', k]);
      for (const [k, v] of Object.entries(policy.rooms)) check(v, ['rooms', k]);
      for (const [k, v] of Object.entries(policy.clients)) check(v, ['clients', k]);
    }),
});

export type AuraConfig = z.infer<typeof auraConfigSchema>;
export type Profile = z.infer<typeof profileSchema>;
