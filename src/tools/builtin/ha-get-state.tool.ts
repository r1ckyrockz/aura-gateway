import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { EntityDirectory } from '../../home-assistant/entity-directory.service';
import { HomeAssistantClient } from '../../home-assistant/ha.client';
import { PolicyService } from '../../policy/policy.service';
import { result, type AuraTool, type ToolContext } from '../tool.types';

const schema = z.object({
  entity_id: z.string().describe('Entity id, e.g. "sensor.living_room_temperature"'),
});

/** Attributes that are noisy or useless for the model. */
const HIDDEN_ATTRIBUTES = new Set([
  'entity_picture',
  'icon',
  'supported_features',
  'attribution',
  'friendly_name',
]);

@Injectable()
export class HaGetStateTool implements AuraTool<typeof schema> {
  readonly name = 'ha_get_state';
  readonly description = 'Get the current state and attributes of one smart-home entity.';
  readonly schema = schema;

  constructor(
    private readonly ha: HomeAssistantClient,
    private readonly directory: EntityDirectory,
    private readonly policy: PolicyService,
  ) {}

  isAvailable() {
    return this.ha.enabled;
  }

  async execute({ entity_id }: z.infer<typeof schema>, { principal }: ToolContext) {
    const entity = await this.directory.get(entity_id);
    if (!entity || !this.policy.canRead(principal, entity)) {
      return result({ error: `Entity ${entity_id} not found or not exposed` });
    }
    const attributes = Object.fromEntries(
      Object.entries(entity.attributes).filter(([key]) => !HIDDEN_ATTRIBUTES.has(key)),
    );
    return result({
      entity_id,
      name: entity.name,
      state: entity.state,
      area: entity.area,
      attributes,
    });
  }
}
