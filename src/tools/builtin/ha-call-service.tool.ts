import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EntityDirectory } from '../../home-assistant/entity-directory.service';
import { HomeAssistantClient } from '../../home-assistant/ha.client';
import type { AuraEntity } from '../../home-assistant/ha.types';
import { PolicyService } from '../../policy/policy.service';
import { result, type AuraTool, type ToolContext, type ToolOutcome } from '../tool.types';

const schema = z.object({
  domain: z.string().describe('Service domain, usually the entity domain, e.g. "light"'),
  service: z.string().describe('Service name, e.g. "turn_on", "turn_off", "set_temperature"'),
  entity_id: z
    .union([z.string(), z.array(z.string()).min(1)])
    .describe('Target entity id or list of entity ids'),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Extra service data, e.g. {"brightness_pct": 40} or {"temperature": 21}'),
});

/** Targets must be given via entity_id so policy checks always apply. */
const FORBIDDEN_DATA_KEYS = ['entity_id', 'device_id', 'area_id', 'floor_id', 'label_id'];
const SERVICE_NAME = /^[a-z0-9_]+$/;

@Injectable()
export class HaCallServiceTool implements AuraTool<typeof schema> {
  readonly name = 'ha_call_service';
  readonly description =
    'Control smart-home devices by calling a Home Assistant service on one or more entities.';
  readonly schema = schema;

  constructor(
    private readonly ha: HomeAssistantClient,
    private readonly directory: EntityDirectory,
    private readonly policy: PolicyService,
  ) {}

  isAvailable() {
    return this.ha.enabled;
  }

  async execute(args: z.infer<typeof schema>, { principal }: ToolContext): Promise<ToolOutcome> {
    const { domain, service } = args;
    const data = args.data ?? {};
    const ids = Array.isArray(args.entity_id) ? args.entity_id : [args.entity_id];

    if (!SERVICE_NAME.test(domain) || !SERVICE_NAME.test(service)) {
      return result({ error: 'Invalid domain or service name' });
    }
    const forbidden = FORBIDDEN_DATA_KEYS.filter((key) => key in data);
    if (forbidden.length > 0) {
      return result({
        error: `Use entity_id for targets; not allowed in data: ${forbidden.join(', ')}`,
      });
    }

    const entities: AuraEntity[] = [];
    let needsConfirmation = false;
    for (const id of ids) {
      const entity = await this.directory.get(id);
      if (!entity || !this.policy.canRead(principal, entity)) {
        return result({ error: `Entity ${id} not found or not exposed` });
      }
      if (domain !== entity.domain && domain !== 'homeassistant') {
        return result({ error: `Service domain "${domain}" does not match entity ${id}` });
      }
      const decision = this.policy.canControl(principal, entity);
      if (!decision.allowed) return result({ error: 'not_permitted', reason: decision.reason });
      needsConfirmation ||= decision.requiresConfirmation;
      entities.push(entity);
    }

    const run = async () => {
      await this.ha.callService(domain, service, { ...data, entity_id: ids });
      this.directory.invalidate();
      return { ok: true, service: `${domain}.${service}`, entities: entities.map((e) => e.name) };
    };

    if (needsConfirmation) {
      return {
        kind: 'confirmation_required',
        action: {
          id: randomUUID(),
          tool: this.name,
          summary: `${domain}.${service} → ${entities.map((e) => e.name).join(', ')}`,
          run,
        },
      };
    }
    return result(await run());
  }
}
