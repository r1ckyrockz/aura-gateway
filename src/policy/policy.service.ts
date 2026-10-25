import { Inject, Injectable } from '@nestjs/common';
import { AURA_CONFIG } from '../config/config.module';
import { ANY, CURRENT_ROOM, type AuraConfig } from '../config/aura-config.schema';
import type { AuraEntity } from '../home-assistant/ha.types';
import type { Decision, Principal, PrincipalInput } from './policy.types';

/** Normalises area/room identifiers so "Kids Room", "kids_room" and "kids-room" match. */
export const normalizeArea = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '_');

/**
 * Household policy: maps speakers, rooms and API clients to profiles and decides
 * what each profile may see and do. The LLM never gets to bypass this.
 */
@Injectable()
export class PolicyService {
  constructor(@Inject(AURA_CONFIG) private readonly config: AuraConfig) {}

  resolve({ speaker, room, client }: PrincipalInput): Principal {
    const { speakers, clients, rooms, defaultProfile, profiles } = this.config.policy;
    const roomKey = room ? findKey(rooms, room) : undefined;

    let resolvedBy: Principal['resolvedBy'] = 'default';
    let profileName = defaultProfile;
    if (speaker && speakers[speaker]) {
      profileName = speakers[speaker];
      resolvedBy = 'speaker';
    } else if (client && clients[client]) {
      profileName = clients[client];
      resolvedBy = 'client';
    } else if (roomKey) {
      profileName = rooms[roomKey];
      resolvedBy = 'room';
    }
    return { profileName, profile: profiles[profileName], speaker, room, client, resolvedBy };
  }

  /** May the principal see this entity at all? */
  canRead(principal: Principal, entity: Pick<AuraEntity, 'entityId'>): boolean {
    return !principal.profile.denyEntities.includes(entity.entityId);
  }

  /** May the principal change this entity? */
  canControl(
    principal: Principal,
    entity: Pick<AuraEntity, 'entityId' | 'domain' | 'area'>,
  ): Decision {
    const { profile, profileName } = principal;
    if (profile.readOnly) {
      return { allowed: false, reason: `Profile "${profileName}" is read-only` };
    }
    if (!this.canRead(principal, entity)) {
      return { allowed: false, reason: `${entity.entityId} is not available to "${profileName}"` };
    }
    if (!profile.allowDomains.includes(ANY) && !profile.allowDomains.includes(entity.domain)) {
      return {
        allowed: false,
        reason: `Profile "${profileName}" may not control ${entity.domain}`,
      };
    }
    if (profile.areas) {
      const allowed = profile.areas
        .map((area) => (area === CURRENT_ROOM ? principal.room : area))
        .filter((area): area is string => Boolean(area))
        .map(normalizeArea);
      if (!entity.area || !allowed.includes(normalizeArea(entity.area))) {
        return {
          allowed: false,
          reason: `Profile "${profileName}" may only control devices in: ${allowed.join(', ') || 'no areas'}`,
        };
      }
    }
    return {
      allowed: true,
      requiresConfirmation: this.config.policy.confirmDomains.includes(entity.domain),
    };
  }
}

function findKey(record: Record<string, string>, wanted: string): string | undefined {
  const target = normalizeArea(wanted);
  return Object.keys(record).find((key) => normalizeArea(key) === target);
}
