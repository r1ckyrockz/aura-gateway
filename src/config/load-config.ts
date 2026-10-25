import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { auraConfigSchema, type AuraConfig } from './aura-config.schema';
import { envSchema, type Env } from './env.schema';

export interface LoadedConfig {
  env: Env;
  aura: AuraConfig;
  /** Absolute path of the YAML file that was loaded, if any. */
  source: string | null;
}

export class ConfigError extends Error {}

function format(error: z.ZodError, label: string): string {
  const issues = error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  return `Invalid ${label}:\n${issues}`;
}

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) throw new ConfigError(format(result.error, 'environment'));
  if (result.data.HA_URL && !result.data.HA_TOKEN) {
    throw new ConfigError('HA_TOKEN is required when HA_URL is set.');
  }
  return result.data;
}

export function parseAuraConfig(raw: unknown): AuraConfig {
  const result = auraConfigSchema.safeParse(raw ?? {});
  if (!result.success) throw new ConfigError(format(result.error, 'AURA config file'));
  return result.data;
}

export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const env = parseEnv(rawEnv);
  const path = resolve(env.AURA_CONFIG_FILE);
  if (!existsSync(path)) {
    return { env, aura: parseAuraConfig({}), source: null };
  }
  const parsed: unknown = parse(readFileSync(path, 'utf8'));
  return { env, aura: parseAuraConfig(parsed), source: path };
}
