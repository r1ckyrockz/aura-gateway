import { Inject, Injectable, Logger } from '@nestjs/common';
import { AURA_CONFIG } from '../config/config.module';
import type { AuraConfig } from '../config/aura-config.schema';
import { errorMessage } from '../common/errors';
import { EntityDirectory } from '../home-assistant/entity-directory.service';
import { HomeAssistantClient } from '../home-assistant/ha.client';
import type { AuraEntity } from '../home-assistant/ha.types';
import { normalizeArea, PolicyService } from '../policy/policy.service';
import type { Principal } from '../policy/policy.types';
import type { ActionRecord } from './conversation.types';
import {
  GENERIC_LIGHT_WORDS,
  normalizeText,
  parseFastCommand,
  type FastCommand,
} from './fast-path';
import { phrases } from './phrases';

export interface FastPathResult {
  text: string;
  actions: ActionRecord[];
}

/**
 * Handles unambiguous on/off commands without an LLM round-trip (milliseconds instead of seconds).
 * Returns `null` whenever anything is unclear — the LLM then takes over.
 */
@Injectable()
export class FastPathService {
  private readonly logger = new Logger(FastPathService.name);

  constructor(
    @Inject(AURA_CONFIG) private readonly config: AuraConfig,
    private readonly ha: HomeAssistantClient,
    private readonly directory: EntityDirectory,
    private readonly policy: PolicyService,
  ) {}

  async tryHandle(
    text: string,
    principal: Principal,
    language: string,
  ): Promise<FastPathResult | null> {
    if (!this.config.fastPath.enabled || !this.ha.enabled) return null;
    const command = parseFastCommand(text, this.config.assistant.name);
    if (!command) return null;

    let entities: AuraEntity[];
    try {
      entities = (await this.directory.list()).filter(
        (e) => this.config.fastPath.domains.includes(e.domain) && this.policy.canRead(principal, e),
      );
    } catch (error) {
      this.logger.warn(`Fast path skipped: ${errorMessage(error)}`);
      return null;
    }

    const targets = resolveTargets(command, entities, principal.room);
    if (!targets || targets.length === 0) return null;

    const say = phrases(language);
    for (const entity of targets) {
      const decision = this.policy.canControl(principal, entity);
      if (!decision.allowed) {
        return {
          text: say.notPermitted,
          actions: [
            {
              tool: 'fast_path',
              arguments: { entity_id: entity.entityId },
              status: 'error',
              result: { error: 'not_permitted', reason: decision.reason },
            },
          ],
        };
      }
      // Let the LLM/confirmation flow handle anything sensitive.
      if (decision.requiresConfirmation) return null;
    }

    const service = command.action === 'on' ? 'turn_on' : 'turn_off';
    const byDomain = new Map<string, string[]>();
    for (const e of targets)
      byDomain.set(e.domain, [...(byDomain.get(e.domain) ?? []), e.entityId]);

    const actions: ActionRecord[] = [];
    try {
      for (const [domain, ids] of byDomain) {
        await this.ha.callService(domain, service, { entity_id: ids });
        actions.push({
          tool: 'fast_path',
          arguments: { domain, service, entity_id: ids },
          status: 'ok',
        });
      }
    } catch (error) {
      this.logger.warn(`Fast path call failed: ${errorMessage(error)}`);
      return {
        text: say.failed,
        actions: [
          ...actions,
          {
            tool: 'fast_path',
            arguments: { service },
            status: 'error',
            result: { error: errorMessage(error) },
          },
        ],
      };
    } finally {
      this.directory.invalidate();
    }

    const reply =
      targets.length === 1
        ? say.switchedOne(targets[0].name, command.action)
        : say.switchedMany(targets.length, command.action);
    return { text: reply, actions };
  }
}

const LIGHT_SUFFIXES = [
  'licht',
  'lichter',
  'lampe',
  'lampen',
  'leuchte',
  'light',
  'lights',
  'lamp',
  'lamps',
];

/**
 * Lights plus switches that obviously switch a light ("Küche Licht", "Hallway Lamp").
 * Many homes control lights with relays (Shelly etc.) that Home Assistant models as switches.
 */
export function isLightLike(entity: Pick<AuraEntity, 'domain' | 'name'>): boolean {
  if (entity.domain === 'light') return true;
  if (entity.domain !== 'switch') return false;
  return normalizeText(entity.name)
    .split(' ')
    .some((word) => LIGHT_SUFFIXES.some((suffix) => word.endsWith(suffix)));
}

const sameArea = (entity: AuraEntity, room: string) =>
  entity.area !== null && normalizeArea(entity.area) === normalizeArea(room);

/** Finds the entities a command refers to; `null` if ambiguous. */
export function resolveTargets(
  command: FastCommand,
  entities: AuraEntity[],
  requestRoom: string | undefined,
): AuraEntity[] | null {
  let { target, room } = command;

  // "kitchen lights" / "wohnzimmer licht" → room = kitchen, target = lights
  const words = target.split(' ');
  if (!room && words.length > 1 && GENERIC_LIGHT_WORDS.has(words.at(-1)!)) {
    const prefix = words.slice(0, -1).join(' ');
    if (entities.some((e) => sameArea(e, prefix))) {
      room = prefix;
      target = words.at(-1)!;
    }
  }

  // Generic: all lights in the room.
  if (GENERIC_LIGHT_WORDS.has(target)) {
    const area = room ?? requestRoom;
    if (!area) return null;
    const lights = entities.filter((e) => isLightLike(e) && sameArea(e, area));
    return lights.length > 0 ? lights : null;
  }

  // Specific device by name.
  const scope = room ? entities.filter((e) => sameArea(e, room)) : entities;
  const exact = scope.filter((e) => normalizeText(e.name) === target);
  if (exact.length === 1) return exact;
  if (exact.length > 1) {
    const inRequestRoom = requestRoom ? exact.filter((e) => sameArea(e, requestRoom)) : [];
    return inRequestRoom.length === 1 ? inRequestRoom : null;
  }
  const localScope = room
    ? scope
    : requestRoom
      ? scope.filter((e) => sameArea(e, requestRoom))
      : [];
  const partial = localScope.filter((e) => normalizeText(e.name).includes(target));
  return partial.length === 1 ? partial : null;
}
