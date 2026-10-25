import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value),
    );

/**
 * Environment variables: connection details, secrets and runtime knobs.
 * Behaviour (assistant persona, exposure, household policy) lives in the YAML config file.
 */
export const envSchema = z.object({
  AURA_HOST: z.string().default('0.0.0.0'),
  AURA_PORT: z.coerce.number().int().positive().default(8080),
  AURA_CONFIG_FILE: z.string().default('aura.config.yaml'),
  AURA_API_KEYS: csv,
  AURA_AUTH_EXEMPT_CIDRS: csv,
  AURA_ENABLE_DOCS: bool(true),
  AURA_OLLAMA_COMPAT: bool(true),

  LLM_BASE_URL: z.string().url().default('http://localhost:11434/v1'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('qwen3:8b'),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  HA_URL: z.string().url().optional(),
  HA_TOKEN: z.string().optional(),
  HA_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;
