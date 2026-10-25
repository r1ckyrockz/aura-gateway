import { Inject, Injectable, Logger } from '@nestjs/common';
import { AURA_CONFIG } from '../config/config.module';
import type { AuraConfig } from '../config/aura-config.schema';
import { errorMessage } from '../common/errors';
import { HomeAssistantClient } from './ha.client';
import { domainOf, type AuraEntity, type HaState } from './ha.types';

/**
 * Cached, exposure-filtered view of Home Assistant entities.
 * Only entities that pass the `homeAssistant.exposure` rules are ever shown to the model.
 */
@Injectable()
export class EntityDirectory {
  private readonly logger = new Logger(EntityDirectory.name);
  private cache?: { at: number; entities: AuraEntity[] };
  private areas?: { at: number; map: Map<string, string | null> };

  constructor(
    private readonly ha: HomeAssistantClient,
    @Inject(AURA_CONFIG) private readonly config: AuraConfig,
  ) {}

  isExposed(entityId: string): boolean {
    const { domains, includeEntities, excludeEntities } = this.config.homeAssistant.exposure;
    if (excludeEntities.includes(entityId)) return false;
    if (includeEntities.includes(entityId)) return true;
    return domains.includes(domainOf(entityId));
  }

  async list(): Promise<AuraEntity[]> {
    const ttl = this.config.homeAssistant.cacheSeconds * 1000;
    if (this.cache && Date.now() - this.cache.at < ttl) return this.cache.entities;

    const [states, areas] = await Promise.all([this.ha.getStates(), this.loadAreas()]);
    const entities = states
      .filter((s) => this.isExposed(s.entity_id))
      .map((s) => toEntity(s, areas.get(s.entity_id) ?? null));
    this.cache = { at: Date.now(), entities };
    return entities;
  }

  async get(entityId: string): Promise<AuraEntity | undefined> {
    if (!this.isExposed(entityId)) return undefined;
    const entities = await this.list();
    return entities.find((e) => e.entityId === entityId);
  }

  /** Drop cached states, e.g. after a service call changed something. */
  invalidate(): void {
    this.cache = undefined;
  }

  private async loadAreas(): Promise<Map<string, string | null>> {
    if (this.areas && Date.now() - this.areas.at < 60_000) return this.areas.map;
    try {
      this.areas = { at: Date.now(), map: await this.ha.getAreas() };
    } catch (error) {
      this.logger.warn(`Could not load areas from Home Assistant: ${errorMessage(error)}`);
      this.areas = { at: Date.now(), map: new Map() };
    }
    return this.areas.map;
  }
}

function toEntity(state: HaState, area: string | null): AuraEntity {
  return {
    entityId: state.entity_id,
    domain: domainOf(state.entity_id),
    name: state.attributes.friendly_name ?? state.entity_id,
    state: state.state,
    area,
    attributes: state.attributes,
  };
}
