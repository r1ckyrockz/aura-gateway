/**
 * Entity patterns used in exposure and policy lists.
 *
 * - `light.kitchen`          exact entity id
 * - `switch.*_relay`         glob on the entity id (`*` = any characters, `?` = one character)
 * - `name:*Deckenheizung`    glob on the friendly name (case-insensitive)
 */
export interface PatternTarget {
  entityId: string;
  name: string;
}

const cache = new Map<string, RegExp>();

function toRegExp(glob: string): RegExp {
  let regex = cache.get(glob);
  if (!regex) {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    regex = new RegExp(`^${escaped}$`, 'iu');
    cache.set(glob, regex);
  }
  return regex;
}

export function matchesPattern(pattern: string, target: PatternTarget): boolean {
  if (pattern.startsWith('name:'))
    return toRegExp(pattern.slice(5).trim()).test(target.name.trim());
  if (!pattern.includes('*') && !pattern.includes('?')) return pattern === target.entityId;
  return toRegExp(pattern).test(target.entityId);
}

export const matchesAny = (patterns: readonly string[], target: PatternTarget) =>
  patterns.some((pattern) => matchesPattern(pattern, target));
