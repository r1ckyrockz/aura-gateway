import { Inject, Injectable, Logger } from '@nestjs/common';
import { AURA_ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { UpstreamError } from '../common/errors';
import { requestJson } from '../common/http';
import { errorMessage } from '../common/errors';
import { fetchAreaMap } from './ha-registry';
import type { HaState } from './ha.types';

/** Jinja template that returns `[{e: entity_id, a: area_name}]` in a single round-trip. */
export const AREA_TEMPLATE =
  '[{% for s in states %}{"e":{{ s.entity_id|tojson }},"a":{{ area_name(s.entity_id)|tojson }}}' +
  '{% if not loop.last %},{% endif %}{% endfor %}]';

/** Thin client for the Home Assistant REST API. */
@Injectable()
export class HomeAssistantClient {
  private readonly logger = new Logger(HomeAssistantClient.name);
  private readonly baseUrl?: string;

  constructor(@Inject(AURA_ENV) private readonly env: Env) {
    this.baseUrl = env.HA_URL?.replace(/\/+$/, '');
  }

  get enabled(): boolean {
    return Boolean(this.baseUrl && this.env.HA_TOKEN);
  }

  async ping(): Promise<void> {
    await this.request('/api/');
  }

  getStates(): Promise<HaState[]> {
    return this.request<HaState[]>('/api/states');
  }

  getState(entityId: string): Promise<HaState> {
    return this.request<HaState>(`/api/states/${encodeURIComponent(entityId)}`);
  }

  /**
   * entity_id → area name. Uses the WebSocket registry (works for non-admin users) and falls back
   * to the REST template endpoint (admin only) if that fails.
   */
  async getAreas(): Promise<Map<string, string | null>> {
    if (!this.enabled)
      throw new UpstreamError('home-assistant', 'Home Assistant is not configured');
    try {
      return await fetchAreaMap(this.baseUrl!, this.env.HA_TOKEN!, this.env.HA_TIMEOUT_MS);
    } catch (error) {
      this.logger.warn(
        `Area registry via WebSocket failed (${errorMessage(error)}), trying template API`,
      );
    }
    return this.getAreasViaTemplate();
  }

  private async getAreasViaTemplate(): Promise<Map<string, string | null>> {
    const raw = await this.request<unknown>('/api/template', { template: AREA_TEMPLATE });
    const rows = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      e: string;
      a: string | null;
    }[];
    return new Map(rows.map((row) => [row.e, row.a]));
  }

  callService(domain: string, service: string, data: Record<string, unknown>): Promise<HaState[]> {
    return this.request<HaState[]>(
      `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      data,
    );
  }

  private request<T>(path: string, body?: unknown): Promise<T> {
    if (!this.enabled) {
      return Promise.reject(
        new UpstreamError('home-assistant', 'Home Assistant is not configured'),
      );
    }
    return requestJson<T>('home-assistant', `${this.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${this.env.HA_TOKEN}` },
      body,
      timeoutMs: this.env.HA_TIMEOUT_MS,
    });
  }
}
