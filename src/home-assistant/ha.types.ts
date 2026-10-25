export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & { friendly_name?: string };
  last_changed?: string;
  last_updated?: string;
}

/** An entity as AURA sees it: state + friendly name + area. */
export interface AuraEntity {
  entityId: string;
  domain: string;
  name: string;
  state: string;
  area: string | null;
  attributes: Record<string, unknown>;
}

export const domainOf = (entityId: string) => entityId.split('.', 1)[0] ?? '';
