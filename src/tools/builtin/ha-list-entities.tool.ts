import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { EntityDirectory } from '../../home-assistant/entity-directory.service';
import { HomeAssistantClient } from '../../home-assistant/ha.client';
import { normalizeArea, PolicyService } from '../../policy/policy.service';
import { result, type AuraTool, type ToolContext } from '../tool.types';

const schema = z.object({
  domain: z.string().optional().describe('Filter by domain, e.g. "light" or "cover"'),
  area: z.string().optional().describe('Filter by area/room name'),
  query: z.string().optional().describe('Case-insensitive search in name or entity id'),
});

const LIMIT = 100;

@Injectable()
export class HaListEntitiesTool implements AuraTool<typeof schema> {
  readonly name = 'ha_list_entities';
  readonly description =
    'List smart-home devices and sensors with their current state. Use filters to narrow results.';
  readonly schema = schema;

  constructor(
    private readonly ha: HomeAssistantClient,
    private readonly directory: EntityDirectory,
    private readonly policy: PolicyService,
  ) {}

  isAvailable() {
    return this.ha.enabled;
  }

  async execute({ domain, area, query }: z.infer<typeof schema>, { principal }: ToolContext) {
    const needle = query?.toLowerCase();
    const matches = (await this.directory.list()).filter(
      (e) =>
        this.policy.canRead(principal, e) &&
        (!domain || e.domain === domain) &&
        (!area || (e.area !== null && normalizeArea(e.area) === normalizeArea(area))) &&
        (!needle || e.name.toLowerCase().includes(needle) || e.entityId.includes(needle)),
    );
    return result({
      total: matches.length,
      truncated: matches.length > LIMIT,
      entities: matches.slice(0, LIMIT).map((e) => ({
        entity_id: e.entityId,
        name: e.name,
        state: e.state,
        area: e.area,
      })),
    });
  }
}
